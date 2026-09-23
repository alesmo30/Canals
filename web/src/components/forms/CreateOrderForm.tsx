import { useState } from 'react';
import { FieldArray, Form, Formik, getIn, type FormikErrors, type FormikTouched } from 'formik';
import * as Yup from 'yup';
import AddIcon from '@mui/icons-material/Add';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SendIcon from '@mui/icons-material/Send';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListSubheader,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

import { CITIES, PRODUCTS, TEST_CARDS } from '../../api/catalog';
import {
  cityKey,
  createOrderDefaults,
  OTHER_CITY,
  toCreateOrderBody,
  toCreateOrderHeaders,
  type CreateOrderValues,
} from '../../lib/create-order-body';
import { formatCents, UUID_SHAPE } from '../../lib/format';
import { useBaseUrl } from '../../store/settings';
import { fonts } from '../../theme';
import { ConfirmDialog } from '../ConfirmDialog';
import { JsonBlock } from '../JsonBlock';

const schema = Yup.object({
  recipient: Yup.string().trim().required('Recipient is required'),
  line1: Yup.string().trim().required('Address line 1 is required'),
  cityKey: Yup.string().required('Pick a city'),
  otherCity: Yup.string().when('cityKey', {
    is: OTHER_CITY,
    then: (field) => field.trim().required('Type a city'),
  }),
  items: Yup.array()
    .of(
      Yup.object({
        productId: Yup.string().required('Pick a product'),
        quantity: Yup.number()
          .typeError('Number')
          .integer('Whole number')
          .min(1, 'At least 1')
          .required('Required'),
      }),
    )
    .min(1, 'Add at least one item')
    .test('distinct', 'Each product can appear only once', (items) => {
      const ids = (items ?? []).map((item) => item.productId);
      return new Set(ids).size === ids.length;
    }),
  cardNumber: Yup.string().matches(/^\d{13,19}$/, '13–19 digits').required(),
  idempotencyKey: Yup.string()
    .trim()
    .required('Required — the API rejects POST /orders without it')
    .matches(UUID_SHAPE, 'Must be a UUID'),
  correlationId: Yup.string().matches(
    /^[A-Za-z0-9-]{1,128}$/,
    'Letters, digits and "-" only (max 128) — otherwise the API generates one',
  ),
});

interface CreateOrderFormProps {
  disabled: boolean;
  onSubmit: (values: CreateOrderValues) => Promise<void>;
}

function fieldError<T>(
  touched: FormikTouched<T>,
  errors: FormikErrors<T>,
  path: string,
): string | undefined {
  const message = getIn(errors, path) as unknown;
  return getIn(touched, path) && typeof message === 'string' ? message : undefined;
}

export function CreateOrderForm({ disabled, onSubmit }: CreateOrderFormProps) {
  const baseUrl = useBaseUrl();
  const [pending, setPending] = useState<CreateOrderValues | null>(null);

  return (
    <Formik<CreateOrderValues>
      initialValues={createOrderDefaults()}
      validationSchema={schema}
      onSubmit={(values) => setPending(values)}
    >
      {(formik) => {
        const { values, errors, touched, handleChange, handleBlur, setFieldValue } = formik;
        const card = TEST_CARDS.find((candidate) => candidate.number === values.cardNumber);
        const body = toCreateOrderBody(values);
        const totalCents = values.items.reduce((sum, item) => {
          const product = PRODUCTS.find((candidate) => candidate.id === item.productId);
          return sum + (product ? product.unitPriceCents * (Number(item.quantity) || 0) : 0);
        }, 0);
        const itemsError = typeof errors.items === 'string' ? errors.items : undefined;
        const err = (path: string) => fieldError(touched, errors, path);

        return (
          <Form noValidate>
            <Stack spacing={3}>
              {/* Headers */}
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Headers
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <TextField
                    name="idempotencyKey"
                    label="Idempotency-Key"
                    size="small"
                    value={values.idempotencyKey}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    error={Boolean(err('idempotencyKey'))}
                    helperText={
                      err('idempotencyKey') ??
                      'Same key + same body replays the stored response; same key + different body → 422.'
                    }
                    slotProps={{
                      input: {
                        sx: { fontFamily: fonts.mono, fontSize: 13 },
                        endAdornment: (
                          <InputAdornment position="end">
                            <Tooltip title="Generate a new key">
                              <IconButton
                                size="small"
                                aria-label="Regenerate Idempotency-Key"
                                onClick={() => void setFieldValue('idempotencyKey', crypto.randomUUID())}
                              >
                                <AutorenewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                  <FormControlLabel
                    sx={{ mt: -1 }}
                    control={
                      <Checkbox
                        size="small"
                        name="autoRegenerateKey"
                        checked={values.autoRegenerateKey}
                        onChange={handleChange}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        New key after each send (untick to demo an idempotent replay)
                      </Typography>
                    }
                  />
                  <TextField
                    name="correlationId"
                    label="X-Correlation-Id (optional)"
                    size="small"
                    value={values.correlationId}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="demo-checkout-1"
                    error={Boolean(err('correlationId'))}
                    helperText={err('correlationId') ?? 'Leave empty and the API generates one.'}
                    slotProps={{ input: { sx: { fontFamily: fonts.mono, fontSize: 13 } } }}
                  />
                </Stack>
              </Box>

              <Divider />

              {/* Shipping address */}
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Shipping address
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <TextField
                    name="recipient"
                    label="Recipient"
                    size="small"
                    value={values.recipient}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    error={Boolean(err('recipient'))}
                    helperText={err('recipient')}
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      name="line1"
                      label="Address line 1"
                      size="small"
                      fullWidth
                      value={values.line1}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      error={Boolean(err('line1'))}
                      helperText={err('line1')}
                    />
                    <TextField
                      name="line2"
                      label="Line 2 (optional)"
                      size="small"
                      fullWidth
                      value={values.line2}
                      onChange={handleChange}
                    />
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      select
                      name="cityKey"
                      label="City"
                      size="small"
                      fullWidth
                      value={values.cityKey}
                      onChange={handleChange}
                      helperText="Cities the static geocoder knows"
                    >
                      {CITIES.map((city) => (
                        <MenuItem key={cityKey(city.city, city.state)} value={cityKey(city.city, city.state)}>
                          {city.city}, {city.state}
                        </MenuItem>
                      ))}
                      <ListSubheader>Error scenario</ListSubheader>
                      <MenuItem value={OTHER_CITY}>Other city… (expect 422 geocoding-failed)</MenuItem>
                    </TextField>
                    <TextField
                      name="postalCode"
                      label="Postal code"
                      size="small"
                      sx={{ minWidth: 140 }}
                      value={values.postalCode}
                      onChange={handleChange}
                    />
                  </Stack>
                  {values.cityKey === OTHER_CITY && (
                    <Stack direction="row" spacing={2}>
                      <TextField
                        name="otherCity"
                        label="City"
                        size="small"
                        fullWidth
                        value={values.otherCity}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        error={Boolean(err('otherCity'))}
                        helperText={err('otherCity')}
                      />
                      <TextField
                        name="otherState"
                        label="State"
                        size="small"
                        sx={{ width: 110 }}
                        value={values.otherState}
                        onChange={handleChange}
                      />
                    </Stack>
                  )}
                  <TextField size="small" label="Country" value="US" disabled helperText="The API only ships within the US" />
                </Stack>
              </Box>

              <Divider />

              {/* Items */}
              <Box>
                <Stack direction="row" sx={{ alignItems: 'center' }}>
                  <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
                    Items
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Estimated total {formatCents(totalCents)}
                  </Typography>
                </Stack>
                <FieldArray name="items">
                  {({ push, remove }) => (
                    <Stack spacing={1.5} sx={{ mt: 1 }}>
                      {values.items.map((item, index) => {
                        const product = PRODUCTS.find((candidate) => candidate.id === item.productId);
                        const chosen = new Set(values.items.map((other) => other.productId));
                        return (
                          <Box key={index}>
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                              <TextField
                                select
                                name={`items.${index}.productId`}
                                label="Product"
                                size="small"
                                fullWidth
                                value={item.productId}
                                onChange={handleChange}
                                error={Boolean(err(`items.${index}.productId`))}
                              >
                                {PRODUCTS.map((candidate) => (
                                  <MenuItem
                                    key={candidate.id}
                                    value={candidate.id}
                                    disabled={candidate.id !== item.productId && chosen.has(candidate.id)}
                                  >
                                    <Box sx={{ display: 'flex', width: '100%', gap: 2 }}>
                                      <Box sx={{ flexGrow: 1 }}>{candidate.name}</Box>
                                      <Box sx={{ color: 'text.secondary' }}>{formatCents(candidate.unitPriceCents)}</Box>
                                    </Box>
                                  </MenuItem>
                                ))}
                              </TextField>
                              <TextField
                                type="number"
                                name={`items.${index}.quantity`}
                                label="Qty"
                                size="small"
                                sx={{ width: 90, flexShrink: 0 }}
                                value={item.quantity}
                                onChange={handleChange}
                                onBlur={handleBlur}
                                error={Boolean(err(`items.${index}.quantity`))}
                                slotProps={{ htmlInput: { min: 1 } }}
                              />
                              <IconButton
                                aria-label="Remove item"
                                disabled={values.items.length === 1}
                                onClick={() => remove(index)}
                                sx={{ mt: 0.25 }}
                              >
                                <DeleteOutlinedIcon />
                              </IconButton>
                            </Stack>
                            {product?.hint && (
                              <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, alignItems: 'center', color: 'secondary.main' }}>
                                <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                                <Typography variant="caption">{product.hint}</Typography>
                              </Stack>
                            )}
                          </Box>
                        );
                      })}
                      {itemsError && (
                        <Typography variant="caption" color="error">
                          {itemsError}
                        </Typography>
                      )}
                      <Box>
                        <Button
                          size="small"
                          startIcon={<AddIcon />}
                          disabled={values.items.length >= PRODUCTS.length}
                          onClick={() => {
                            const chosen = new Set(values.items.map((item) => item.productId));
                            const next = PRODUCTS.find((product) => !chosen.has(product.id));
                            if (next) {
                              push({ productId: next.id, quantity: 1 });
                            }
                          }}
                        >
                          Add item
                        </Button>
                      </Box>
                    </Stack>
                  )}
                </FieldArray>
              </Box>

              <Divider />

              {/* Payment */}
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Payment — test card
                </Typography>
                <TextField
                  select
                  name="cardNumber"
                  label="Card"
                  size="small"
                  fullWidth
                  sx={{ mt: 1 }}
                  value={values.cardNumber}
                  onChange={handleChange}
                >
                  {TEST_CARDS.map((candidate) => (
                    <MenuItem key={candidate.number} value={candidate.number}>
                      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', width: '100%' }}>
                        <Box sx={{ fontFamily: fonts.mono, fontSize: 13 }}>
                          •••• {candidate.number.slice(-4)}
                        </Box>
                        <Box sx={{ flexGrow: 1 }}>{candidate.label}</Box>
                        <Chip size="small" label={candidate.expectedStatus} color={candidate.outcome} variant="outlined" />
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
                {card && (
                  <Alert severity={card.outcome} variant="outlined" sx={{ mt: 1.5 }}>
                    <strong>Expected: {card.expectedStatus}.</strong> {card.expected}
                  </Alert>
                )}
              </Box>

              {/* Body preview */}
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Body preview
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <JsonBlock value={body} tone="light" maxHeight={260} />
                </Box>
              </Box>

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={disabled}
                endIcon={<SendIcon />}
              >
                Review and send
              </Button>
            </Stack>

            <ConfirmDialog
              open={pending !== null}
              method="POST"
              url={`${baseUrl}/orders`}
              headers={pending ? toCreateOrderHeaders(pending) : {}}
              body={pending ? toCreateOrderBody(pending) : null}
              warning={
                pending?.cardNumber.endsWith('0004')
                  ? 'Card 0004 makes the provider hang — expect ~6 s before the API answers 502.'
                  : undefined
              }
              onCancel={() => setPending(null)}
              onConfirm={() => {
                const submitted = pending;
                setPending(null);
                if (!submitted) {
                  return;
                }
                void onSubmit(submitted).then(() => {
                  if (submitted.autoRegenerateKey) {
                    void setFieldValue('idempotencyKey', crypto.randomUUID());
                  }
                });
              }}
            />
          </Form>
        );
      }}
    </Formik>
  );
}
