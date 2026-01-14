#!/usr/bin/env node

/**
 * hosty - One-command deploy any MCP server to Vercel
 *
 * Usage:
 *   hosty deploy [path]    Deploy an MCP server
 *   hosty check [path]     Check if a project is a valid MCP server
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve } from "node:path";

import { detect, formatDetectionResult } from "./detector.js";
import { deploy, checkVercelCli, formatDeploymentResult } from "./deployer.js";
import { formatConfigOutput, generateTestCommand } from "./config.js";

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
  .option("--no-auth", "Don't generate auth token")
  .action(async (path: string, options) => {
    const projectPath = resolve(path);

    // Check Vercel CLI
    const spinner = ora("Checking Vercel CLI...").start();
    const vercelStatus = await checkVercelCli();

    if (!vercelStatus.installed) {
      spinner.fail("Vercel CLI not found");
      console.log(chalk.yellow("\nInstall with: npm i -g vercel"));
      process.exit(1);
    }

    if (!vercelStatus.authenticated) {
      spinner.fail("Not logged in to Vercel");
      console.log(chalk.yellow("\nRun: vercel login"));
      process.exit(1);
    }

    spinner.succeed("Vercel CLI ready");

    // Detect MCP server
    spinner.start("Detecting MCP server...");
    const serverInfo = await detect(projectPath);

    if (!serverInfo.isValid) {
      spinner.fail("Not a valid MCP server");
      console.log(chalk.red("\n" + formatDetectionResult(serverInfo)));
      process.exit(1);
    }

    spinner.succeed(`Found ${serverInfo.type} MCP server: ${serverInfo.name}`);

    // Show warnings
    for (const warning of serverInfo.warnings) {
      console.log(chalk.yellow(`  Warning: ${warning}`));
    }

    // Deploy
    spinner.start("Deploying to Vercel...");

    const result = await deploy(serverInfo, {
      production: options.prod,
      projectName: options.name,
      team: options.team,
      authToken: options.auth === false ? undefined : undefined, // Let deploy generate
    });

    if (!result.success) {
      spinner.fail("Deployment failed");
      console.log(chalk.red(`\n${result.error}`));
      process.exit(1);
    }

    spinner.succeed("Deployed!");

    // Output result
    console.log("");
    console.log(chalk.green("MCP server deployed successfully"));
    console.log("");
    console.log(chalk.dim("URL: ") + result.url);
    console.log(chalk.dim("MCP: ") + result.mcpConfig?.transport.url);

    if (result.mcpConfig?.auth) {
      console.log(chalk.dim("Key: ") + result.mcpConfig.auth.token);
    }

    console.log("");
    console.log(chalk.dim("─".repeat(50)));
    console.log("");
    console.log(formatConfigOutput(result));
    console.log("");
    console.log(chalk.dim("Test with:"));
    console.log(chalk.dim("  " + generateTestCommand(result.mcpConfig!)));
  });

program
  .command("check")
  .description("Check if a project is a valid MCP server")
  .argument("[path]", "Path to check", ".")
  .action(async (path: string) => {
    const projectPath = resolve(path);
    const info = await detect(projectPath);

    if (info.isValid) {
      console.log(chalk.green("Valid MCP server"));
      console.log(formatDetectionResult(info));
    } else {
      console.log(chalk.red("Not a valid MCP server"));
      console.log(formatDetectionResult(info));
      process.exit(1);
    }
  });

// Default to help if no command
program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
