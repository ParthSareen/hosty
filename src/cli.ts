#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve } from "node:path";
import { detect } from "./detector.js";
import { deploy, checkVercelCli } from "./deployer.js";
import { listServers, getServer } from "./store.js";
import { generateClaudeDesktopConfig } from "./config.js";

const program = new Command();

program
  .name("hosty")
  .description("One-command deploy any MCP server to Vercel")
  .version("0.1.0");

program
  .command("deploy")
  .description("Deploy an MCP server to Vercel")
  .argument("[path]", "Path to MCP server project", ".")
  .option("--prod", "Deploy to production")
  .option("--name <name>", "Project name on Vercel")
  .option("--team <team>", "Vercel team/org scope")
  .action(async (path: string, options) => {
    const projectPath = resolve(path);
    const spinner = ora();

    // Check Vercel CLI
    spinner.start("Checking Vercel CLI...");
    const vercel = await checkVercelCli();
    if (!vercel.ok) {
      spinner.fail(vercel.error);
      process.exit(1);
    }
    spinner.succeed("Vercel CLI ready");

    // Detect MCP server
    spinner.start("Detecting MCP server...");
    const info = await detect(projectPath);
    if (!info.isValid) {
      spinner.fail("Not a valid MCP server");
      info.errors.forEach((e) => console.log(chalk.red(`  ${e}`)));
      process.exit(1);
    }
    spinner.succeed(`Found ${info.type} MCP server: ${info.name}`);

    // Deploy
    spinner.start("Deploying to Vercel...");
    const result = await deploy(info, {
      production: options.prod,
      projectName: options.name,
      team: options.team,
    });

    if (!result.success) {
      spinner.fail("Deployment failed");
      console.log(chalk.red(result.error));
      process.exit(1);
    }
    spinner.succeed("Deployed!");

    // Output
    console.log("");
    console.log(chalk.green("MCP server is live"));
    console.log("");
    console.log(`URL: ${result.url}`);
    console.log(`MCP: ${result.mcpConfig?.transport.url}`);
    console.log(`Key: ${result.mcpConfig?.auth?.token}`);
    console.log("");
    console.log(chalk.dim("Saved to ~/.hosty/servers.json"));
    console.log("");
    console.log(chalk.dim("─".repeat(50)));
    console.log("");
    console.log("Add to Claude Desktop config:");
    console.log("");
    console.log(generateClaudeDesktopConfig(result.mcpConfig!));
    console.log("");
    console.log(chalk.dim("Test:"));
    console.log(chalk.dim(`  curl -H "Authorization: Bearer ${result.mcpConfig?.auth?.token}" ${result.mcpConfig?.transport.url}`));
  });

program
  .command("list")
  .description("List deployed MCP servers")
  .action(async () => {
    const servers = await listServers();
    if (servers.length === 0) {
      console.log(chalk.dim("No servers deployed yet. Run: hosty deploy ./your-mcp-server"));
      return;
    }

    console.log(chalk.bold("Deployed MCP servers:\n"));
    for (const server of servers) {
      console.log(`${chalk.green(server.name)}`);
      console.log(`  URL: ${server.url}`);
      console.log(`  Deployed: ${server.deployedAt}`);
      console.log("");
    }
  });

program
  .command("config")
  .description("Get config for a deployed server")
  .argument("<name>", "Server name")
  .action(async (name: string) => {
    const server = await getServer(name);
    if (!server) {
      console.log(chalk.red(`Server "${name}" not found. Run: hosty list`));
      process.exit(1);
    }

    console.log(generateClaudeDesktopConfig({
      name: server.name,
      transport: { type: "sse", url: `${server.url}/api/mcp` },
      auth: server.authToken ? { type: "bearer", token: server.authToken } : undefined,
    }));
  });

program
  .command("check")
  .description("Check if a project is a valid MCP server")
  .argument("[path]", "Path to check", ".")
  .action(async (path: string) => {
    const info = await detect(resolve(path));
    if (info.isValid) {
      console.log(chalk.green(`Valid ${info.type} MCP server: ${info.name}`));
      console.log(`  Entry: ${info.entryPoint}`);
    } else {
      console.log(chalk.red("Not a valid MCP server"));
      info.errors.forEach((e) => console.log(`  ${e}`));
      process.exit(1);
    }
  });

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
