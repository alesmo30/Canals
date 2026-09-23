import { useMemo } from 'react';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import SendIcon from '@mui/icons-material/Send';
import { Autocomplete, Box, Button, Stack, TextField, Typography } from '@mui/material';

import { UUID_SHAPE } from '../../lib/format';
import { useExecutions } from '../../store/executions';
import { fonts } from '../../theme';

interface GetOrderFormProps {
  disabled: boolean;
  initialOrderId?: string;
  onSubmit: (orderId: string) => void;
}

const schema = Yup.object({
  orderId: Yup.string().trim().required('Enter an order id'),
});

export function GetOrderForm({ disabled, initialOrderId, onSubmit }: GetOrderFormProps) {
  const executions = useExecutions();
  // Order ids seen in earlier executions, newest first, deduplicated.
  const knownOrderIds = useMemo(
    () => [
      ...new Set(
        executions
          .map((execution) => execution.orderId)
          .filter((id): id is string => Boolean(id)),
      ),
    ],
    [executions],
  );

  return (
    <Formik
      initialValues={{ orderId: initialOrderId ?? '' }}
      enableReinitialize
      validationSchema={schema}
      onSubmit={(values) => onSubmit(values.orderId.trim())}
    >
      {({ values, errors, touched, setFieldValue, setFieldTouched }) => (
        <Form noValidate>
          <Stack spacing={2}>
            <Autocomplete
              freeSolo
              options={knownOrderIds}
              value={values.orderId}
              onInputChange={(_, value) => void setFieldValue('orderId', value)}
              renderOption={(props, option) => {
                const { key, ...rest } = props;
                return (
                  <Box component="li" key={key} {...rest} sx={{ fontFamily: fonts.mono, fontSize: 13 }}>
                    {option}
                  </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Order id"
                  size="small"
                  onBlur={() => void setFieldTouched('orderId', true)}
                  error={Boolean(touched.orderId && errors.orderId)}
                  helperText={
                    (touched.orderId && errors.orderId) ||
                    (values.orderId && !UUID_SHAPE.test(values.orderId.trim())
                      ? 'Not UUID-shaped — the API will answer 404 (same as an unknown id).'
                      : knownOrderIds.length > 0
                        ? 'Pick an order from earlier executions, or paste any id.'
                        : 'Create an order first, or paste any id.')
                  }
                />
              )}
            />
            <Typography variant="body2" color="text.secondary">
              Returns the order with its items, warehouse, every payment attempt and the shipment.
            </Typography>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={disabled}
              endIcon={<SendIcon />}
            >
              Send request
            </Button>
          </Stack>
        </Form>
      )}
    </Formik>
  );
}
