// Stock Count API — all server code in one file so the api folder stays flat.
// Needs the SQL_CONNECTION_STRING environment variable set in the Static Web App.
const { app } = require('@azure/functions');
const sql = require('mssql');

let poolPromise = null;
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

const cleanText = v => (typeof v === 'string' ? v.trim() : '');
const cleanQty = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
};
const WAKING = 'The database may be starting up, so try again in a minute.';
const fail = (status, error) => ({ status, jsonBody: { error } });

// Name of the signed-in user, if Microsoft sign-in is switched on.
function signedInUser(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return '';
  try {
    const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return cleanText(principal.userDetails);
  } catch { return ''; }
}

const COUNT_COLUMNS = `
  Id AS id, FirstName AS firstName, LastName AS lastName,
  Apples AS apples, Bananas AS bananas, Sultanas AS sultanas,
  SubmittedAt AS submittedAt, UpdatedAt AS updatedAt, UpdatedBy AS updatedBy,
  EditNote AS editNote, CAST(RowVer AS BIGINT) AS version`;

// POST /api/submit — saves one new stock count
app.http('submit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try { body = await request.json(); } catch { return fail(400, 'Request body must be JSON.'); }

    const firstName = cleanText(body.firstName);
    const lastName = cleanText(body.lastName);
    const apples = cleanQty(body.apples);
    const bananas = cleanQty(body.bananas);
    const sultanas = cleanQty(body.sultanas);

    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
      return fail(400, 'Enter a first and last name (up to 100 characters each).');
    }
    if ([apples, bananas, sultanas].includes(null)) {
      return fail(400, 'Quantities must be whole numbers of 0 or more.');
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
      return fail(503, `The count could not be saved. ${WAKING}`);
    }
  }
});

// GET /api/counts — recent counts, keys match the field ids in form.json
app.http('counts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'counts',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(
        `SELECT TOP 500 ${COUNT_COLUMNS} FROM dbo.StockCounts ORDER BY SubmittedAt DESC`);
      return { status: 200, jsonBody: result.recordset };
    } catch (err) {
      context.error('Query failed', err);
      return fail(503, `Counts could not be loaded. ${WAKING}`);
    }
  }
});

// GET /api/counts/{id} — one count
// PUT /api/counts/{id} — recount: updates the quantities and records who and why
app.http('countById', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'counts/{id:int}',
  handler: async (request, context) => {
    const id = Number(request.params.id);
    try {
      const pool = await getPool();

      if (request.method === 'GET') {
        const result = await pool.request().input('Id', sql.Int, id)
          .query(`SELECT ${COUNT_COLUMNS} FROM dbo.StockCounts WHERE Id = @Id`);
        return result.recordset.length
          ? { status: 200, jsonBody: result.recordset[0] }
          : fail(404, 'That count no longer exists.');
      }

      let body;
      try { body = await request.json(); } catch { return fail(400, 'Request body must be JSON.'); }

      const apples = cleanQty(body.apples);
      const bananas = cleanQty(body.bananas);
      const sultanas = cleanQty(body.sultanas);
      const updatedBy = signedInUser(request) || cleanText(body.updatedBy);
      const note = cleanText(body.note) || 'Recount';
      const version = cleanText(String(body.version ?? ''));

      if ([apples, bananas, sultanas].includes(null)) {
        return fail(400, 'Quantities must be whole numbers of 0 or more.');
      }
      if (!updatedBy || updatedBy.length > 100) return fail(400, 'Enter who did the recount (up to 100 characters).');
      if (note.length > 200) return fail(400, 'Keep the reason under 200 characters.');
      if (!/^\d+$/.test(version)) return fail(400, 'Reload the page and try again.');

      const result = await pool.request()
        .input('Id', sql.Int, id)
        .input('Version', sql.BigInt, version)
        .input('Apples', sql.Int, apples)
        .input('Bananas', sql.Int, bananas)
        .input('Sultanas', sql.Int, sultanas)
        .input('UpdatedBy', sql.NVarChar(100), updatedBy)
        .input('EditNote', sql.NVarChar(200), note)
        .query(`UPDATE dbo.StockCounts
                SET Apples = @Apples, Bananas = @Bananas, Sultanas = @Sultanas,
                    UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @UpdatedBy, EditNote = @EditNote
                OUTPUT inserted.Id AS id, inserted.FirstName AS firstName, inserted.LastName AS lastName,
                       inserted.Apples AS apples, inserted.Bananas AS bananas, inserted.Sultanas AS sultanas,
                       inserted.SubmittedAt AS submittedAt, inserted.UpdatedAt AS updatedAt,
                       inserted.UpdatedBy AS updatedBy, inserted.EditNote AS editNote,
                       CAST(inserted.RowVer AS BIGINT) AS version
                WHERE Id = @Id AND CAST(RowVer AS BIGINT) = @Version`);

      if (result.recordset.length) return { status: 200, jsonBody: result.recordset[0] };

      const exists = await pool.request().input('Id', sql.Int, id)
        .query('SELECT 1 AS found FROM dbo.StockCounts WHERE Id = @Id');
      return exists.recordset.length
        ? fail(409, 'Someone else changed this count while you were editing. Reload to see the latest numbers.')
        : fail(404, 'That count no longer exists.');
    } catch (err) {
      context.error('Count request failed', err);
      return fail(503, `The count could not be updated. ${WAKING}`);
    }
  }
});

// GET /api/counts/{id}/history — every version of one count, newest first
app.http('countHistory', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'counts/{id:int}/history',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().input('Id', sql.Int, Number(request.params.id))
        .query(`SELECT Apples AS apples, Bananas AS bananas, Sultanas AS sultanas,
                       UpdatedBy AS updatedBy, EditNote AS editNote, ValidFrom AS validFrom
                FROM dbo.StockCounts FOR SYSTEM_TIME ALL
                WHERE Id = @Id
                ORDER BY ValidFrom DESC`);
      return { status: 200, jsonBody: result.recordset };
    } catch (err) {
      context.error('History query failed', err);
      return fail(503, `History could not be loaded. ${WAKING}`);
    }
  }
});
