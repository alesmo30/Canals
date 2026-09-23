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

/** The only supported market. */
const SUPPORTED_COUNTRY = 'US';

/** Shape only (13–19 digits); the provider decides the outcome. */
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
  // 'loose': any 8-4-4-4-12 hex shape. The seed/test fixture ids are
  // readable non-v4 strings that the default 'all' would reject.
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

/** `items[]` must not repeat a `productId` — rejected, never merged. */
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
