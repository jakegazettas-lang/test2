# Stock Count

A stock count form and dashboard hosted on Azure Static Web Apps, saving to Azure SQL.

- `form.json` defines the form: titles, fields, labels, limits and chart colours.
- `index.html` builds the form from `form.json`.
- `dashboard.html` shows the saved counts as charts and a table.
- `api/` saves and reads counts from the database (`SQL_CONNECTION_STRING` is set in Azure).
- `staticwebapp.config.json` holds the Azure hosting settings.
- `create-table.sql` creates the database table (run once in the Azure Query editor).
