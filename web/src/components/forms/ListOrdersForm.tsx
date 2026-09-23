import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import SendIcon from '@mui/icons-material/Send';
import {
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';

import { ORDER_STATUSES, WAREHOUSES } from '../../api/catalog';
import { LIST_ORDERS_DEFAULTS, type ListOrdersValues } from '../../lib/list-orders-query';

const schema = Yup.object({
  pageSize: Yup.number()
    .integer('Whole number')
    .min(1, 'Minimum 1')
    .max(100, 'Maximum 100 (API limit)')
    .required('Required'),
  createdAtTo: Yup.string().test(
    'after-from',
    'Must be after "Created from"',
    function (value) {
      const { createdAtFrom } = this.parent as ListOrdersValues;
      return !value || !createdAtFrom || new Date(value) >= new Date(createdAtFrom);
    },
  ),
});

interface ListOrdersFormProps {
  disabled: boolean;
  onSubmit: (values: ListOrdersValues) => void;
}

export function ListOrdersForm({ disabled, onSubmit }: ListOrdersFormProps) {
  return (
    <Formik
      initialValues={LIST_ORDERS_DEFAULTS}
      validationSchema={schema}
      onSubmit={(values) => onSubmit(values)}
    >
      {({ values, errors, touched, handleChange, handleBlur }) => (
        <Form noValidate>
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Checkbox
                  name="onlyFixedCustomer"
                  checked={values.onlyFixedCustomer}
                  onChange={handleChange}
                />
              }
              label="Only the fixed test customer's orders"
            />
            <TextField
              select
              name="status"
              label="Status"
              value={values.status}
              onChange={handleChange}
              size="small"
            >
              <MenuItem value="">Any status</MenuItem>
              {ORDER_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              name="warehouseId"
              label="Warehouse"
              value={values.warehouseId}
              onChange={handleChange}
              size="small"
            >
              <MenuItem value="">Any warehouse</MenuItem>
              {WAREHOUSES.map((warehouse) => (
                <MenuItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name} · {warehouse.city}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                type="datetime-local"
                name="createdAtFrom"
                label="Created from"
                value={values.createdAtFrom}
                onChange={handleChange}
                size="small"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="datetime-local"
                name="createdAtTo"
                label="Created to"
                value={values.createdAtTo}
                onChange={handleChange}
                onBlur={handleBlur}
                size="small"
                fullWidth
                error={Boolean(touched.createdAtTo && errors.createdAtTo)}
                helperText={touched.createdAtTo && errors.createdAtTo}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <TextField
              type="number"
              name="pageSize"
              label="Page size"
              value={values.pageSize}
              onChange={handleChange}
              onBlur={handleBlur}
              size="small"
              error={Boolean(touched.pageSize && errors.pageSize)}
              helperText={
                (touched.pageSize && errors.pageSize) ||
                'Keyset pagination — use "Load next page" to follow nextCursor.'
              }
            />
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
