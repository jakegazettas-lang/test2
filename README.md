# Stock Count

A stock count form and dashboard on Azure Static Web Apps, saving to Azure SQL.

- `form.json` defines the form: titles, fields, labels, limits and chart colours.
- `index.html` builds the form from `form.json`.
- `dashboard.html` shows saved counts as charts and a table.
- `staticwebapp.config.json` sets the API to run on Node 22.
- `api/` holds the database code: `host.json`, `package.json` and `index.js`.
  The database connection comes from the `SQL_CONNECTION_STRING` setting in Azure.
