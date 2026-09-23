const { app } = require('@azure/functions');
const { sql, getPool } = require('../db');

const cleanName = v => (typeof v === 'string' ? v.trim() : '');
const cleanQty = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
};

// POST /api/submit  — saves one stock count
app.http('submit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try { body = await request.json(); }
    catch { return { status: 400, jsonBody: { error: 'Request body must be JSON.' } }; }

    const firstName = cleanName(body.firstName);
    const lastName = cleanName(body.lastName);
    const apples = cleanQty(body.apples);
    const bananas = cleanQty(body.bananas);
    const sultanas = cleanQty(body.sultanas);

    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      return { status: 400, jsonBody: { error: 'Enter a first and last name (up to 100 characters each).' } };
    }
    if ([apples, bananas, sultanas].includes(null)) {
      return { status: 400, jsonBody: { error: 'Quantities must be whole numbers of 0 or more.' } };
    }

    try {
      const pool = await getPool();
      await pool.request()
        .input('FirstName', sql.NVarChar(100), firstName)
        .input('LastName', sql.NVarChar(100), lastName)
        .input('Apples', sql.Int, apples)
        .input('Bananas', sql.Int, bananas)
        .input('Sultanas', sql.Int, sultanas)
        .query(`INSERT INTO dbo.StockCounts (FirstName, LastName, Apples, Bananas, Sultanas)
                VALUES (@FirstName, @LastName, @Apples, @Bananas, @Sultanas)`);
      return { status: 201, jsonBody: { ok: true } };
    } catch (err) {
      context.error('Insert failed', err);
      return { status: 503, jsonBody: { error: 'The count could not be saved. The database may be starting up, so try again in a minute.' } };
    }
  }
});
