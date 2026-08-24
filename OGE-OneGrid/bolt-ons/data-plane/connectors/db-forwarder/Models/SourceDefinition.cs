using System.Text.Json.Serialization;

namespace DbForwarder.Models;

/// <summary>Which relational provider a source uses.</summary>
public enum DbProvider
{
    SqlServer,
    Oracle
}

/// <summary>Row shape of the source query.</summary>
public enum SourceShape
{
    /// <summary>One row per reading: (tag, ts, value[, plant, quality]). Maps directly.</summary>
    Narrow,
    /// <summary>One row per asset/timestamp with many measurement columns; each mapped
    /// column is unpivoted into its own event (see <see cref="SourceDefinition.Measures"/>).</summary>
    Wide
}

/// <summary>How the watermark column is typed/compared.</summary>
public enum WatermarkType
{
    /// <summary>DateTime/DateTimeOffset column. Supports OverlapSeconds re-read window.</summary>
    DateTime,
    /// <summary>Monotonic numeric column (identity/sequence/rowversion). Exactly-once-friendly.</summary>
    Long
}

/// <summary>Column-name → canonical-field mapping for the source query result set.</summary>
public sealed class ColumnMap
{
    [JsonPropertyName("tag")]     public string? Tag { get; set; }
    [JsonPropertyName("ts")]      public string? Ts { get; set; }
    [JsonPropertyName("value")]   public string? Value { get; set; }
    [JsonPropertyName("plant")]   public string? Plant { get; set; }
    [JsonPropertyName("quality")] public string? Quality { get; set; }
    [JsonPropertyName("webId")]   public string? WebId { get; set; }
}

/// <summary>One measurement column to unpivot when <see cref="SourceShape.Wide"/>.</summary>
public sealed class WideMeasure
{
    [JsonPropertyName("column")] public string Column { get; set; } = "";
    [JsonPropertyName("tag")]    public string Tag { get; set; } = "";
    [JsonPropertyName("webId")]  public string? WebId { get; set; }
}

/// <summary>
/// One entry in sources.json — a relational source to poll. Analog of the PI
/// connector's tags.json entry.
/// </summary>
public sealed class SourceDefinition
{
    /// <summary>Logical id for this source; also used as the event <c>host</c> label.</summary>
    [JsonPropertyName("name")] public string Name { get; set; } = "";

    [JsonPropertyName("provider")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public DbProvider Provider { get; set; } = DbProvider.SqlServer;

    /// <summary>Key used to resolve the connection string from env/user-secrets
    /// (<c>DBFWD_CONN_&lt;NAME&gt;</c>). Preferred over an inline connection string.</summary>
    [JsonPropertyName("connectionName")] public string ConnectionName { get; set; } = "";

    /// <summary>Inline connection string (testing only — prefer connectionName; never commit a real value).</summary>
    [JsonPropertyName("connectionString")] public string? ConnectionString { get; set; }

    [JsonPropertyName("pollIntervalSeconds")] public int PollIntervalSeconds { get; set; } = 15;

    /// <summary>SELECT that returns new rows. Must reference the watermark parameter:
    /// <c>@watermark</c> for SqlServer, <c>:watermark</c> for Oracle. Order by the watermark column.</summary>
    [JsonPropertyName("query")] public string Query { get; set; } = "";

    /// <summary>Result-set column whose max value advances the watermark.</summary>
    [JsonPropertyName("watermarkColumn")] public string WatermarkColumn { get; set; } = "";

    [JsonPropertyName("watermarkType")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public WatermarkType WatermarkType { get; set; } = WatermarkType.DateTime;

    /// <summary>Optional starting watermark (ISO-8601 for DateTime, integer for Long).
    /// If absent, defaults to epoch/0 — set this to avoid a full-history backfill.</summary>
    [JsonPropertyName("initialWatermark")] public string? InitialWatermark { get; set; }

    /// <summary>DateTime only: re-read window (seconds) subtracted from the watermark each
    /// poll to catch boundary/late rows. At-least-once downstream dedupes any overlap.</summary>
    [JsonPropertyName("overlapSeconds")] public int OverlapSeconds { get; set; } = 2;

    [JsonPropertyName("shape")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public SourceShape Shape { get; set; } = SourceShape.Narrow;

    /// <summary>Default plant label if the map has no <c>plant</c> column.</summary>
    [JsonPropertyName("plant")] public string Plant { get; set; } = "";

    /// <summary>Producer label emitted in the <c>source</c> field (defaults to sql/oracle).</summary>
    [JsonPropertyName("source")] public string? Source { get; set; }

    [JsonPropertyName("map")] public ColumnMap Map { get; set; } = new();

    /// <summary>Wide shape only: the measurement columns to unpivot.</summary>
    [JsonPropertyName("measures")] public List<WideMeasure>? Measures { get; set; }
}

/// <summary>Path to sources.json.</summary>
public sealed class DbForwarderOptions
{
    public string SourcesConfigPath { get; set; } = "";
    /// <summary>Directory for the watermark state db (defaults next to the queue).</summary>
    public string? StatePath { get; set; }
}
