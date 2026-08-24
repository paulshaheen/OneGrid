using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Forwarder.Core.Models;
using Forwarder.Core.Queue;
using DbForwarder.Models;

namespace DbForwarder.Db;

/// <summary>
/// Polls one relational source: runs its watermark query, maps each row to the
/// canonical <see cref="SourceEvent"/>, enqueues the batch, and only then advances
/// the persisted watermark (durable boundary → at-least-once).
/// </summary>
public sealed class RelationalPoller
{
    private readonly ISqliteQueue _queue;
    private readonly WatermarkStore _wm;
    private readonly ILogger<RelationalPoller> _log;

    public RelationalPoller(ISqliteQueue queue, WatermarkStore wm, ILogger<RelationalPoller> log)
    {
        _queue = queue;
        _wm = wm;
        _log = log;
    }

    /// <summary>Returns the number of events enqueued this cycle.</summary>
    public async Task<int> PollOnceAsync(SourceDefinition s, CancellationToken ct)
    {
        var stored = await _wm.GetAsync(s.Name, ct) ?? s.InitialWatermark;
        var (paramValue, lastDt, lastLong) = ResolveWatermark(s, stored);

        var factory = DbProviderResolver.Factory(s.Provider);
        using var conn = factory.CreateConnection()
            ?? throw new InvalidOperationException($"Provider {s.Provider} returned no connection.");
        conn.ConnectionString = DbProviderResolver.ResolveConnectionString(s);
        await conn.OpenAsync(ct);

        using var cmd = conn.CreateCommand();
        cmd.CommandText = s.Query;
        DbProviderResolver.AddWatermarkParameter(cmd, s.Provider, paramValue);

        var events = new List<QueuedEvent>();
        var sourceLabel = s.Source ?? (s.Provider == DbProvider.Oracle ? "oracle" : "sql");

        DateTimeOffset maxDt = lastDt;
        long maxLong = lastLong;
        var advanced = false;

        using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            var ords = new ColumnOrdinals(reader, s);
            if (ords.Watermark < 0)
                throw new InvalidOperationException(
                    $"Source '{s.Name}': watermarkColumn '{s.WatermarkColumn}' not in result set.");

            while (await reader.ReadAsync(ct))
            {
                // Track the max watermark seen (real max, not the overlap-shifted value).
                if (s.WatermarkType == WatermarkType.DateTime)
                {
                    if (!reader.IsDBNull(ords.Watermark))
                    {
                        var dt = ToUtc(reader.GetValue(ords.Watermark));
                        if (dt > maxDt) { maxDt = dt; advanced = true; }
                    }
                }
                else
                {
                    if (!reader.IsDBNull(ords.Watermark))
                    {
                        var lv = Convert.ToInt64(reader.GetValue(ords.Watermark), CultureInfo.InvariantCulture);
                        if (lv > maxLong) { maxLong = lv; advanced = true; }
                    }
                }

                if (s.Shape == SourceShape.Wide)
                    AddWideEvents(reader, ords, s, sourceLabel, events);
                else
                    AddNarrowEvent(reader, ords, s, sourceLabel, events);
            }
        }

        if (events.Count > 0)
            await _queue.EnqueueBatchAsync(events, ct);

        // Advance the watermark ONLY after a successful enqueue.
        if (advanced && events.Count > 0)
        {
            var newWm = s.WatermarkType == WatermarkType.DateTime
                ? maxDt.UtcDateTime.ToString("o", CultureInfo.InvariantCulture)
                : maxLong.ToString(CultureInfo.InvariantCulture);
            await _wm.SetAsync(s.Name, newWm, ct);
        }

        if (events.Count > 0)
            _log.LogInformation("[{Source}] enqueued {Count} event(s)", s.Name, events.Count);
        return events.Count;
    }

    private void AddNarrowEvent(DbDataReader reader, ColumnOrdinals o, SourceDefinition s, string sourceLabel, List<QueuedEvent> outEvents)
    {
        var tag = o.Tag >= 0 && !reader.IsDBNull(o.Tag) ? reader.GetValue(o.Tag)?.ToString() ?? "" : "";
        var webId = o.WebId >= 0 && !reader.IsDBNull(o.WebId) ? reader.GetValue(o.WebId)?.ToString() ?? tag : tag;
        var plant = o.Plant >= 0 && !reader.IsDBNull(o.Plant) ? reader.GetValue(o.Plant)?.ToString() ?? s.Plant : s.Plant;
        var value = o.Value >= 0 && !reader.IsDBNull(o.Value) ? UnboxDbValue(reader.GetValue(o.Value)) : null;
        var ts = o.Ts >= 0 && !reader.IsDBNull(o.Ts) ? ToUtc(reader.GetValue(o.Ts)) : DateTimeOffset.UtcNow;
        var questionable = o.Quality >= 0 && !reader.IsDBNull(o.Quality) && IsQuestionable(reader.GetValue(o.Quality));

        outEvents.Add(Wrap(new SourceEvent
        {
            WebId = webId, Tag = tag, Plant = plant, Ts = ts, Value = value,
            Questionable = questionable, Source = sourceLabel
        }));
    }

    private void AddWideEvents(DbDataReader reader, ColumnOrdinals o, SourceDefinition s, string sourceLabel, List<QueuedEvent> outEvents)
    {
        if (s.Measures is null || s.Measures.Count == 0) return;
        var plant = o.Plant >= 0 && !reader.IsDBNull(o.Plant) ? reader.GetValue(o.Plant)?.ToString() ?? s.Plant : s.Plant;
        var ts = o.Ts >= 0 && !reader.IsDBNull(o.Ts) ? ToUtc(reader.GetValue(o.Ts)) : DateTimeOffset.UtcNow;

        foreach (var m in s.Measures)
        {
            int ord;
            try { ord = reader.GetOrdinal(m.Column); } catch { continue; }
            if (ord < 0 || reader.IsDBNull(ord)) continue;
            outEvents.Add(Wrap(new SourceEvent
            {
                WebId = m.WebId ?? m.Tag, Tag = m.Tag, Plant = plant, Ts = ts,
                Value = UnboxDbValue(reader.GetValue(ord)), Source = sourceLabel
            }));
        }
    }

    private static QueuedEvent Wrap(SourceEvent evt) => new()
    {
        EnqueuedTs = DateTimeOffset.UtcNow,
        WebId = evt.WebId,
        Plant = evt.Plant,
        PayloadJsonUtf8 = JsonSerializer.SerializeToUtf8Bytes(evt)
    };

    /// <summary>Resolve the query parameter value + typed "last" watermark for max-tracking.</summary>
    private static (object paramValue, DateTimeOffset lastDt, long lastLong) ResolveWatermark(SourceDefinition s, string? stored)
    {
        if (s.WatermarkType == WatermarkType.DateTime)
        {
            var last = stored is not null && DateTimeOffset.TryParse(stored, CultureInfo.InvariantCulture,
                           DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
                       ? d : DateTimeOffset.FromUnixTimeSeconds(0);
            // Overlap re-read window to catch boundary/late rows (at-least-once dedupes).
            var effective = last.AddSeconds(-Math.Max(0, s.OverlapSeconds));
            return (effective.UtcDateTime, last, 0L);
        }
        else
        {
            var last = stored is not null && long.TryParse(stored, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l)
                       ? l : 0L;
            return (last, DateTimeOffset.FromUnixTimeSeconds(0), last);
        }
    }

    private static DateTimeOffset ToUtc(object v) => v switch
    {
        DateTimeOffset dto => dto.ToUniversalTime(),
        DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
        string sv => DateTimeOffset.Parse(sv, CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
        _ => DateTimeOffset.UtcNow
    };

    private static object? UnboxDbValue(object v) => v switch
    {
        null or DBNull => null,
        bool b => b,
        byte or sbyte or short or ushort or int or uint or long or ulong => Convert.ToInt64(v, CultureInfo.InvariantCulture),
        float or double => Convert.ToDouble(v, CultureInfo.InvariantCulture),
        decimal dec => (double)dec,
        DateTime dt => dt.ToString("o", CultureInfo.InvariantCulture),
        DateTimeOffset dto => dto.ToString("o", CultureInfo.InvariantCulture),
        string sv => sv,
        _ => v.ToString()
    };

    private static bool IsQuestionable(object q) => q switch
    {
        bool b => !b,
        string sv => sv.Trim().ToLowerInvariant() is "bad" or "questionable" or "uncertain" or "0" or "false",
        _ when q is byte or sbyte or short or ushort or int or uint or long or ulong
            => Convert.ToInt64(q, CultureInfo.InvariantCulture) == 0,
        _ => false
    };

    /// <summary>Pre-resolved column ordinals for the mapped fields.</summary>
    private sealed class ColumnOrdinals
    {
        public int Tag = -1, Ts = -1, Value = -1, Plant = -1, Quality = -1, WebId = -1, Watermark = -1;

        public ColumnOrdinals(DbDataReader reader, SourceDefinition s)
        {
            Tag     = Ord(reader, s.Map.Tag);
            Ts      = Ord(reader, s.Map.Ts);
            Value   = Ord(reader, s.Map.Value);
            Plant   = Ord(reader, s.Map.Plant);
            Quality = Ord(reader, s.Map.Quality);
            WebId   = Ord(reader, s.Map.WebId);
            Watermark = Ord(reader, s.WatermarkColumn);
        }

        private static int Ord(DbDataReader reader, string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return -1;
            try { return reader.GetOrdinal(name); } catch { return -1; }
        }
    }
}
