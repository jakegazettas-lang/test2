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

// ───────────── Daily stock take sheet ─────────────

const SIZES = ['Small', 'Medium', 'Large', 'Boxes', 'Units'];
const isoDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : null);
const hhmm = v => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);

// Checks a submitted stocktake and returns { header, lines } or { error }
function readStocktake(body) {
  const header = {
    stocktakeDate: isoDate(body.stocktakeDate),
    countedBy1: cleanText(body.countedBy1),
    countedBy2: cleanText(body.countedBy2),
    startTime: body.startTime ? hhmm(body.startTime) : null,
    finishTime: body.finishTime ? hhmm(body.finishTime) : null
  };
  if (!header.stocktakeDate) return { error: 'Choose the stocktake date.' };
  if (!header.countedBy1 || header.countedBy1.length > 100 || header.countedBy2.length > 100) {
    return { error: 'Enter who did the stocktake (up to 100 characters per name).' };
  }
  if (body.startTime && !header.startTime) return { error: 'Start time is not valid.' };
  if (body.finishTime && !header.finishTime) return { error: 'Finish time is not valid.' };

  if (!Array.isArray(body.lines) || body.lines.length > 400) return { error: 'The stocktake lines are missing or too long.' };
  const lines = [];
  for (const l of body.lines) {
    const line = {
      section: cleanText(l.section).slice(0, 60),
      product: cleanText(l.product),
      size: SIZES.includes(l.size) ? l.size : null,
      batch: [1, 2].includes(Number(l.batch)) ? Number(l.batch) : null,
      unavailable: l.unavailable === true,
      qty: l.qty === null || l.qty === '' || l.qty === undefined ? null : cleanQty(l.qty),
      useBy: l.useBy ? isoDate(l.useBy) : null
    };
    if (!line.section || !line.product || line.product.length > 120 || !line.size || !line.batch) {
      return { error: 'One of the lines is not in the right format. Reload the page and try again.' };
    }
    if (!line.unavailable) {
      if (line.qty === null) return { error: `${line.product} (${line.size}) needs a whole-number quantity of 0 or more.` };
      if (l.useBy && !line.useBy) return { error: `${line.product} (${line.size}) has a use-by date that is not valid.` };
    }
    lines.push(line);
  }
  if (!lines.length) return { error: 'Enter at least one quantity before saving.' };
  return { header, lines };
}

// Adds all lines for one stocktake in a single statement
async function insertLines(tx, stocktakeId, lines) {
  const req = new sql.Request(tx).input('StocktakeId', sql.Int, stocktakeId);
  const values = lines.map((l, i) => {
    req.input(`s${i}`, sql.NVarChar(60), l.section)
       .input(`p${i}`, sql.NVarChar(120), l.product)
       .input(`z${i}`, sql.NVarChar(20), l.size)
       .input(`b${i}`, sql.TinyInt, l.batch)
       .input(`q${i}`, sql.Int, l.unavailable ? null : l.qty)
       .input(`u${i}`, sql.NVarChar(10), l.unavailable ? null : l.useBy)
       .input(`n${i}`, sql.Bit, l.unavailable);
    return `(@StocktakeId, @s${i}, @p${i}, @z${i}, @b${i}, @q${i}, TRY_CONVERT(date, @u${i}, 23), @n${i})`;
  });
  await req.query(`INSERT INTO dbo.StocktakeLines (StocktakeId, Section, Product, Size, Batch, Qty, UseBy, Unavailable)
                   VALUES ${values.join(',\n')}`);
}

const STOCKTAKE_COLUMNS = `
  s.Id AS id, CONVERT(char(10), s.StocktakeDate, 23) AS stocktakeDate,
  s.CountedBy1 AS countedBy1, s.CountedBy2 AS countedBy2,
  CONVERT(char(5), s.StartTime, 108) AS startTime, CONVERT(char(5), s.FinishTime, 108) AS finishTime,
  s.SubmittedAt AS submittedAt, s.SubmittedBy AS submittedBy,
  s.UpdatedAt AS updatedAt, s.UpdatedBy AS updatedBy, s.EditNote AS editNote,
  CAST(s.RowVer AS BIGINT) AS version`;

async function loadStocktake(pool, id) {
  const head = await pool.request().input('Id', sql.Int, id)
    .query(`SELECT ${STOCKTAKE_COLUMNS} FROM dbo.Stocktakes s WHERE s.Id = @Id`);
  if (!head.recordset.length) return null;
  const lines = await pool.request().input('Id', sql.Int, id)
    .query(`SELECT Section AS section, Product AS product, Size AS size, Batch AS batch, Qty AS qty,
                   CONVERT(char(10), UseBy, 23) AS useBy, Unavailable AS unavailable
            FROM dbo.StocktakeLines WHERE StocktakeId = @Id ORDER BY Id`);
  return { ...head.recordset[0], lines: lines.recordset };
}

// GET /api/stocktakes — list with totals
// POST /api/stocktakes — save a new stocktake
app.http('stocktakes', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'stocktakes',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      if (request.method === 'GET') {
        const result = await pool.request().query(`
          SELECT TOP 200 ${STOCKTAKE_COLUMNS},
                 ISNULL(t.totalQty, 0) AS totalQty, ISNULL(t.linesCounted, 0) AS linesCounted,
                 ISNULL(t.unavailableCount, 0) AS unavailableCount,
                 CONVERT(char(10), t.soonestUseBy, 23) AS soonestUseBy
          FROM dbo.Stocktakes s
          OUTER APPLY (
            SELECT SUM(Qty) AS totalQty,
                   SUM(CASE WHEN Unavailable = 0 THEN 1 ELSE 0 END) AS linesCounted,
                   COUNT(DISTINCT CASE WHEN Unavailable = 1 THEN Product END) AS unavailableCount,
                   MIN(CASE WHEN Qty > 0 THEN UseBy END) AS soonestUseBy
            FROM dbo.StocktakeLines l WHERE l.StocktakeId = s.Id
          ) t
          ORDER BY s.StocktakeDate DESC, s.Id DESC`);
        return { status: 200, jsonBody: result.recordset };
      }

      let body;
      try { body = await request.json(); } catch { return fail(400, 'Request body must be JSON.'); }
      const parsed = readStocktake(body);
      if (parsed.error) return fail(400, parsed.error);
      const { header, lines } = parsed;

      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const ins = await new sql.Request(tx)
          .input('StocktakeDate', sql.NVarChar(10), header.stocktakeDate)
          .input('CountedBy1', sql.NVarChar(100), header.countedBy1)
          .input('CountedBy2', sql.NVarChar(100), header.countedBy2 || null)
          .input('StartTime', sql.NVarChar(5), header.startTime)
          .input('FinishTime', sql.NVarChar(5), header.finishTime)
          .input('SubmittedBy', sql.NVarChar(200), signedInUser(request) || null)
          .query(`INSERT INTO dbo.Stocktakes (StocktakeDate, CountedBy1, CountedBy2, StartTime, FinishTime, SubmittedBy)
                  OUTPUT inserted.Id AS id
                  VALUES (CONVERT(date, @StocktakeDate, 23), @CountedBy1, @CountedBy2,
                          TRY_CONVERT(time(0), @StartTime), TRY_CONVERT(time(0), @FinishTime), @SubmittedBy)`);
        const id = ins.recordset[0].id;
        await insertLines(tx, id, lines);
        await tx.commit();
        return { status: 201, jsonBody: await loadStocktake(pool, id) };
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      }
    } catch (err) {
      context.error('Stocktakes request failed', err);
      return fail(503, `The stocktake could not be ${request.method === 'GET' ? 'loaded' : 'saved'}. ${WAKING}`);
    }
  }
});

// GET /api/stocktakes/{id} — one stocktake with all its lines
// PUT /api/stocktakes/{id} — correct a stocktake (the previous version is kept)
app.http('stocktakeById', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'stocktakes/{id:int}',
  handler: async (request, context) => {
    const id = Number(request.params.id);
    try {
      const pool = await getPool();
      if (request.method === 'GET') {
        const st = await loadStocktake(pool, id);
        return st ? { status: 200, jsonBody: st } : fail(404, 'That stocktake no longer exists.');
      }

      let body;
      try { body = await request.json(); } catch { return fail(400, 'Request body must be JSON.'); }
      const parsed = readStocktake(body);
      if (parsed.error) return fail(400, parsed.error);
      const { header, lines } = parsed;
      const version = cleanText(String(body.version ?? ''));
      const note = cleanText(body.note) || 'Corrected';
      const who = signedInUser(request) || header.countedBy1;
      if (!/^\d+$/.test(version)) return fail(400, 'Reload the page and try again.');
      if (note.length > 200) return fail(400, 'Keep the reason under 200 characters.');

      const current = await loadStocktake(pool, id);
      if (!current) return fail(404, 'That stocktake no longer exists.');
      if (String(current.version) !== version) {
        return fail(409, 'Someone else changed this stocktake while you were editing. Reload to see the latest.');
      }

      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx)
          .input('Id', sql.Int, id)
          .input('Snapshot', sql.NVarChar(sql.MAX), JSON.stringify(current))
          .input('ReplacedBy', sql.NVarChar(200), who)
          .query('INSERT INTO dbo.StocktakeRevisions (StocktakeId, Snapshot, ReplacedBy) VALUES (@Id, @Snapshot, @ReplacedBy)');
        const upd = await new sql.Request(tx)
          .input('Id', sql.Int, id)
          .input('Version', sql.BigInt, version)
          .input('StocktakeDate', sql.NVarChar(10), header.stocktakeDate)
          .input('CountedBy1', sql.NVarChar(100), header.countedBy1)
          .input('CountedBy2', sql.NVarChar(100), header.countedBy2 || null)
          .input('StartTime', sql.NVarChar(5), header.startTime)
          .input('FinishTime', sql.NVarChar(5), header.finishTime)
          .input('UpdatedBy', sql.NVarChar(200), who)
          .input('EditNote', sql.NVarChar(200), note)
          .query(`UPDATE dbo.Stocktakes
                  SET StocktakeDate = CONVERT(date, @StocktakeDate, 23), CountedBy1 = @CountedBy1, CountedBy2 = @CountedBy2,
                      StartTime = TRY_CONVERT(time(0), @StartTime), FinishTime = TRY_CONVERT(time(0), @FinishTime),
                      UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @UpdatedBy, EditNote = @EditNote
                  WHERE Id = @Id AND CAST(RowVer AS BIGINT) = @Version`);
        if (!upd.rowsAffected[0]) {
          await tx.rollback();
          return fail(409, 'Someone else changed this stocktake while you were editing. Reload to see the latest.');
        }
        await new sql.Request(tx).input('Id', sql.Int, id).query('DELETE FROM dbo.StocktakeLines WHERE StocktakeId = @Id');
        await insertLines(tx, id, lines);
        await tx.commit();
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      }
      return { status: 200, jsonBody: await loadStocktake(pool, id) };
    } catch (err) {
      context.error('Stocktake request failed', err);
      return fail(503, `The stocktake could not be ${request.method === 'GET' ? 'loaded' : 'updated'}. ${WAKING}`);
    }
  }
});

// GET /api/stocktakes/{id}/history — earlier versions, newest first
app.http('stocktakeHistory', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'stocktakes/{id:int}/history',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().input('Id', sql.Int, Number(request.params.id))
        .query(`SELECT Snapshot AS snapshot, ReplacedAt AS replacedAt, ReplacedBy AS replacedBy
                FROM dbo.StocktakeRevisions WHERE StocktakeId = @Id ORDER BY ReplacedAt DESC, Id DESC`);
      return { status: 200, jsonBody: result.recordset.map(r => ({ ...JSON.parse(r.snapshot), replacedAt: r.replacedAt, replacedBy: r.replacedBy })) };
    } catch (err) {
      context.error('Stocktake history failed', err);
      return fail(503, `History could not be loaded. ${WAKING}`);
    }
  }
});
