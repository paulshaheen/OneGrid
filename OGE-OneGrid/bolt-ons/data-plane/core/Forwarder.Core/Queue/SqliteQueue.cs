using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Forwarder.Core.Models;
using Forwarder.Core.Options;

namespace Forwarder.Core.Queue;

/// <summary>
/// SQLite-backed durable outbox. WAL mode for concurrent enqueue + drain.
/// Delete-after-ack semantics: events stay until the publisher confirms broker receipt.
/// </summary>
public sealed class SqliteQueue : ISqliteQueue, IDisposable
{
    private readonly QueueOptions _opts;
    private readonly ILogger<SqliteQueue> _log;
    private readonly string _connectionString;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public SqliteQueue(IOptions<QueueOptions> opts, ILogger<SqliteQueue> log)
    {
        _opts = opts.Value;
        _log = log;

        var dir = Path.GetDirectoryName(_opts.Path);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = _opts.Path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true
        }.ToString();

        Initialize();
        _log.LogInformation("SQLite queue ready at {Path}", _opts.Path);
    }

    private void Initialize()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous  = NORMAL;
            PRAGMA temp_store   = MEMORY;
            PRAGMA cache_size   = -65536;

            CREATE TABLE IF NOT EXISTS pending (
                rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
                enqueued_ts INTEGER NOT NULL,
                web_id      TEXT    NOT NULL,
                plant       TEXT    NOT NULL,
                payload     BLOB    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_pending_enqueued ON pending(enqueued_ts);
            """;
        cmd.ExecuteNonQuery();
    }

    private SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    public async Task EnqueueBatchAsync(IReadOnlyList<QueuedEvent> events, CancellationToken ct)
    {
        if (events.Count == 0) return;

        await _writeLock.WaitAsync(ct);
        try
        {
            using var conn = OpenConnection();
            using var tx = conn.BeginTransaction();
            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO pending (enqueued_ts, web_id, plant, payload)
                VALUES ($enq, $web, $plant, $payload)
                """;
            var pEnq     = cmd.Parameters.Add("$enq",     SqliteType.Integer);
            var pWeb     = cmd.Parameters.Add("$web",     SqliteType.Text);
            var pPlant   = cmd.Parameters.Add("$plant",   SqliteType.Text);
            var pPayload = cmd.Parameters.Add("$payload", SqliteType.Blob);

            foreach (var e in events)
            {
                pEnq.Value     = e.EnqueuedTs.ToUnixTimeMilliseconds();
                pWeb.Value     = e.WebId;
                pPlant.Value   = e.Plant;
                pPayload.Value = e.PayloadJsonUtf8;
                await cmd.ExecuteNonQueryAsync(ct);
            }
            tx.Commit();
        }
        finally { _writeLock.Release(); }
    }

    public async Task<IReadOnlyList<QueuedEvent>> PeekBatchAsync(int max, int maxBytes, CancellationToken ct)
    {
        var batch = new List<QueuedEvent>(Math.Min(max, 1024));
        var totalBytes = 0;

        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT rowid, enqueued_ts, web_id, plant, payload
            FROM pending
            ORDER BY rowid
            LIMIT $max
            """;
        cmd.Parameters.AddWithValue("$max", max);

        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var rowId       = reader.GetInt64(0);
            var enqMs       = reader.GetInt64(1);
            var webId       = reader.GetString(2);
            var plant       = reader.GetString(3);
            var payloadLen  = (int)reader.GetBytes(4, 0, null, 0, 0);
            var payload     = new byte[payloadLen];
            reader.GetBytes(4, 0, payload, 0, payloadLen);

            // Honor maxBytes cap
            if (batch.Count > 0 && totalBytes + payloadLen > maxBytes) break;

            batch.Add(new QueuedEvent
            {
                RowId = rowId,
                EnqueuedTs = DateTimeOffset.FromUnixTimeMilliseconds(enqMs),
                WebId = webId,
                Plant = plant,
                PayloadJsonUtf8 = payload
            });
            totalBytes += payloadLen;
        }
        return batch;
    }

    public async Task<int> DeleteAckedAsync(IEnumerable<long> rowIds, CancellationToken ct)
    {
        var ids = rowIds.ToList();
        if (ids.Count == 0) return 0;

        await _writeLock.WaitAsync(ct);
        try
        {
            using var conn = OpenConnection();
            using var tx = conn.BeginTransaction();
            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM pending WHERE rowid = $id";
            var p = cmd.Parameters.Add("$id", SqliteType.Integer);
            var deleted = 0;
            foreach (var id in ids)
            {
                p.Value = id;
                deleted += await cmd.ExecuteNonQueryAsync(ct);
            }
            tx.Commit();
            return deleted;
        }
        finally { _writeLock.Release(); }
    }

    public async Task<long> DepthAsync(CancellationToken ct)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM pending";
        var result = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt64(result);
    }

    public Task<long> SizeBytesAsync(CancellationToken ct)
    {
        try
        {
            var fi = new FileInfo(_opts.Path);
            return Task.FromResult(fi.Exists ? fi.Length : 0L);
        }
        catch
        {
            return Task.FromResult(0L);
        }
    }

    public void Dispose()
    {
        _writeLock.Dispose();
        SqliteConnection.ClearAllPools();
    }
}
