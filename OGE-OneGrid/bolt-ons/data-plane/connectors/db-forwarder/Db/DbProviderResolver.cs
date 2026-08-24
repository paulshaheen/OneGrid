using System.Data.Common;
using Microsoft.Data.SqlClient;
using Oracle.ManagedDataAccess.Client;
using DbForwarder.Models;

namespace DbForwarder.Db;

/// <summary>
/// Resolves the ADO.NET provider factory + connection string for a source, and
/// creates the provider-appropriate watermark parameter. Keeps the poller
/// provider-agnostic.
/// </summary>
public static class DbProviderResolver
{
    public static DbProviderFactory Factory(DbProvider provider) => provider switch
    {
        DbProvider.SqlServer => SqlClientFactory.Instance,
        DbProvider.Oracle    => OracleClientFactory.Instance,
        _ => throw new NotSupportedException($"Unsupported provider {provider}")
    };

    /// <summary>
    /// Resolve the connection string: inline value if present, else the environment
    /// variable <c>DBFWD_CONN_&lt;CONNECTIONNAME&gt;</c> (name upper-cased, non-alnum → '_').
    /// Never stored in the repo.
    /// </summary>
    public static string ResolveConnectionString(SourceDefinition s)
    {
        if (!string.IsNullOrWhiteSpace(s.ConnectionString))
            return s.ConnectionString!;

        if (string.IsNullOrWhiteSpace(s.ConnectionName))
            throw new InvalidOperationException(
                $"Source '{s.Name}' has neither connectionString nor connectionName.");

        var key = "DBFWD_CONN_" + NormalizeKey(s.ConnectionName);
        var val = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrWhiteSpace(val))
            throw new InvalidOperationException(
                $"Source '{s.Name}': connection string not found. Set environment variable '{key}'.");
        return val;
    }

    /// <summary>The parameter placeholder used in the query for this provider.</summary>
    public static string WatermarkPlaceholder(DbProvider provider) =>
        provider == DbProvider.Oracle ? ":watermark" : "@watermark";

    /// <summary>Add the watermark parameter to a command with provider-correct naming.</summary>
    public static void AddWatermarkParameter(DbCommand cmd, DbProvider provider, object value)
    {
        var p = cmd.CreateParameter();
        // SqlClient binds by "@name"; Oracle binds the single param positionally (BindByName off).
        p.ParameterName = provider == DbProvider.Oracle ? "watermark" : "@watermark";
        p.Value = value ?? DBNull.Value;
        cmd.Parameters.Add(p);
    }

    private static string NormalizeKey(string name)
    {
        var chars = name.ToUpperInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '_').ToArray();
        return new string(chars);
    }
}
