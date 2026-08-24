using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;
using DbForwarder;
using DbForwarder.Db;
using DbForwarder.Loops;
using DbForwarder.Models;
using Forwarder.Core;
using Forwarder.Core.Health;
using Forwarder.Core.Loops;
using Forwarder.Core.Options;
using Forwarder.Core.Publish;
using Forwarder.Core.Queue;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(opts => opts.ServiceName = "DbFabricForwarder");

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o =>
{
    o.SingleLine = true;
    o.TimestampFormat = "HH:mm:ss.fff ";
});
if (OperatingSystem.IsWindows())
{
#pragma warning disable CA1416
    builder.Logging.AddEventLog(o => o.SourceName = "DbFabricForwarder");
#pragma warning restore CA1416
}

// Options — shared core options + db-forwarder source config.
builder.Services.Configure<FabricOptions>(builder.Configuration.GetSection("Fabric"));
builder.Services.Configure<QueueOptions>(builder.Configuration.GetSection("Queue"));
builder.Services.Configure<HealthOptions>(builder.Configuration.GetSection("Health"));
builder.Services.Configure<DbForwarderOptions>(builder.Configuration.GetSection("DbForwarder"));

// Core singletons (durable queue + publisher + metrics).
builder.Services.AddSingleton<Metrics>();
builder.Services.AddSingleton<ISqliteQueue, SqliteQueue>();
builder.Services.AddSingleton<FabricPublisher>();

// db-forwarder source pipeline.
builder.Services.AddSingleton<SourceRegistry>();
builder.Services.AddSingleton<WatermarkStore>();
builder.Services.AddSingleton<RelationalPoller>();

// The poll loop is the source-health provider + a hosted service.
builder.Services.AddSingleton<RelationalPollLoop>();
builder.Services.AddSingleton<ISourceHealth>(sp => sp.GetRequiredService<RelationalPollLoop>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<RelationalPollLoop>());

// Shared core hosted services (drain queue + heartbeat).
builder.Services.AddHostedService<PublisherLoop>();
builder.Services.AddHostedService<HealthLoop>();

var host = builder.Build();

// Eager-load so config errors surface at startup.
_ = host.Services.GetRequiredService<SourceRegistry>();
_ = host.Services.GetRequiredService<ISqliteQueue>();
_ = host.Services.GetRequiredService<WatermarkStore>();

await host.RunAsync();
