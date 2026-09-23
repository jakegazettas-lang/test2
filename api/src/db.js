const sql = require('mssql');

let poolPromise = null;

// Reuses one database connection across requests.
async function getPool() {
  if (!poolPromise) {
    const connectionString = process.env.SQL_CONNECTION_STRING;
    if (!connectionString) throw new Error('SQL_CONNECTION_STRING is not set');
    poolPromise = new sql.ConnectionPool(connectionString)
      .connect()
      .catch(err => { poolPromise = null; throw err; });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
