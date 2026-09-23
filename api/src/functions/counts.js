const { app } = require('@azure/functions');
const { getPool } = require('../db');

// GET /api/counts — recent stock counts, keys match the field ids in form.json
app.http('counts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(
        `SELECT TOP 500
           Id AS id, FirstName AS firstName, LastName AS lastName,
           Apples AS apples, Bananas AS bananas, Sultanas AS sultanas,
           SubmittedAt AS submittedAt
         FROM dbo.StockCounts
         ORDER BY SubmittedAt DESC`
      );
      return { status: 200, jsonBody: result.recordset };
    } catch (err) {
      context.error('Query failed', err);
      return { status: 503, jsonBody: { error: 'Counts could not be loaded. The database may be starting up, so try again in a minute.' } };
    }
  }
});
