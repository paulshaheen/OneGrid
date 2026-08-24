using System.Text.Json.Serialization;

namespace Forwarder.Core.Models;

/// <summary>
/// Canonical event shape every data-plane connector publishes to the Fabric
/// Eventstream custom endpoint. Field names map 1:1 to the accelerator's
/// <c>PiEventsRaw</c> table + <c>PiEventsRawMapping</c>. Keep these names stable —
/// they are the wire contract shared by all sources (PI, SQL, Oracle, ...).
/// </summary>
public sealed class SourceEvent
{
    [JsonPropertyName("webId")]        public string WebId { get; set; } = "";
    [JsonPropertyName("tag")]          public string Tag { get; set; } = "";
    [JsonPropertyName("ts")]           public DateTimeOffset Ts { get; set; }
    [JsonPropertyName("value")]        public object? Value { get; set; }
    [JsonPropertyName("valueType")]    public string? ValueType { get; set; }
    [JsonPropertyName("questionable")] public bool Questionable { get; set; }
    [JsonPropertyName("substituted")]  public bool Substituted { get; set; }
    [JsonPropertyName("plant")]        public string Plant { get; set; } = "";
    /// <summary>Producer/mode label carried through to the payload (e.g. channel|poll|sql|oracle).</summary>
    [JsonPropertyName("source")]       public string Source { get; set; } = "";
    [JsonPropertyName("host")]         public string Host { get; set; } = Environment.MachineName;
}
