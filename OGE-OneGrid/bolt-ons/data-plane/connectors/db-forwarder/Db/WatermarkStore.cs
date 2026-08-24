using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Forwarder.Core.Options;
using DbForwarder.Models;

namespace DbForwarder.Db;

/// <summary>
/// Durable per-source high-watermark store (small SQLite db beside the queue).
/// The watermark advances ONLY after rows are safely enqueued, so a crash replays
/// at most one batch (at-least-once, tolerated downstream).
/// </summary>
public sealed class WatermarkStore
{
    private readonly string _connectionString;
    private readonly ILogger<WatermarkStore> _log;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public WatermarkStore(IOptions<DbForwarderOptions> dbOpts, IOptions<QueueOptions> qOpts, ILogger<WatermarkStore> log)
    {
        _log = log;
        var stateDir = dbOpts.Value.StatePath;
        if (string.IsNullOrWhiteSpace(stateDir))
            stateDir = Path.GetDirectoryName(qOpts.Value.Path);
        if (string.IsNullOrWhiteSpace(stateDir)) stateDir = ".";
        if (!Directory.Exists(stateDir)) Directory.CreateDirectory(stateDir);

        var dbPath = Path.Combine(stateDir, "watermark.db");
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true
        }.ToString();

        using var conn = new SqliteConnection(_connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS watermarks (
                source     TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_ts INTEGER NOT NULL
            );
            """;
        cmd.ExecuteNonQuery();
        _log.LogInformation("Watermark store ready at {Path}", dbPath);
    }

    /// <summary>Get the stored watermark string for a source, or null if none yet.</summary>
    public async Task<string?> GetAsync(string source, CancellationToken ct)
    {
        using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync(ct);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT value FROM watermarks WHERE source = $s";
        cmd.Parameters.AddWithValue("$s", source);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result as string;
    }

    /// <summary>Persist the watermark for a source (upsert).</summary>
    public async Task SetAsync(string source, string value, CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            using var conn = new SqliteConnection(_connectionString);
            await conn.OpenAsync(ct);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO watermarks (source, value, updated_ts) VALUES ($s, $v, $t)
                ON CONFLICT(source) DO UPDATE SET value = $v, updated_ts = $t
                """;
            cmd.Parameters.AddWithValue("$s", source);
            cmd.Parameters.AddWithValue("$v", value);
            cmd.Parameters.AddWithValue("$t", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await cmd.ExecuteNonQueryAsync(ct);
        }
        finally { _lock.Release(); }
    }
}
