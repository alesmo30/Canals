import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

/** FR-1: the only market this saga supports — see specs/05-order-creation-saga.md, Decisions. */
const SUPPORTED_COUNTRY = 'US';

/** Only shape, 13-19 digits — the mock decides the real outcome by the exact value (specs/05, Decisions). */
const CARD_NUMBER_PATTERN = /^\d{13,19}$/;

export class ShippingAddressDto {
  @IsString()
  recipient!: string;

  @IsString()
  line1!: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsIn([SUPPORTED_COUNTRY])
  country!: 'US';
}

export class OrderLineDto {
  // 'loose': accepts any 8-4-4-4-12 hex-dash shape, not just RFC4122's
  // version/variant nibbles. Real ids are gen_random_uuid() (always
  // valid v4), but this codebase's own fixed test/seed ids
  // (seed.ts's a0000000-.../b0000000-..., concurrency-check.ts's
  // d0000000-..., events-check.ts's e0000000-...) are deliberately
  // readable, sequential, non-v4 "uuid-shaped" strings — 'all' (the
  // default) rejects them outright, which would make POST /orders
  // impossible to exercise against npm run seed's own data.
  @IsUUID('loose')
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class PaymentDto {
  @IsString()
  @Matches(CARD_NUMBER_PATTERN, {
    message: 'cardNumber must contain only digits, 13-19 characters',
  })
  cardNumber!: string;
}

@ValidatorConstraint({ name: 'uniqueProductIds', async: false })
class UniqueProductIdsConstraint implements ValidatorConstraintInterface {
  validate(items: unknown): boolean {
    if (!Array.isArray(items)) {
      return true;
    }
    const productIds = (items as OrderLineDto[]).map((item) => item.productId);
    return new Set(productIds).size === productIds.length;
  }

  defaultMessage(): string {
    return 'items must not contain a duplicate productId';
  }
}

/** `items[]` must not repeat a `productId` — rejected outright, never merged (specs/05, Decisions). */
function UniqueProductIds(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: UniqueProductIdsConstraint,
    });
  };
}

export class CreateOrderDto {
  // 'loose' — see OrderLineDto.productId's comment above.
  @IsUUID('loose')
  customerId!: string;

  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  @UniqueProductIds()
  items!: OrderLineDto[];

  @ValidateNested()
  @Type(() => PaymentDto)
  payment!: PaymentDto;
}
