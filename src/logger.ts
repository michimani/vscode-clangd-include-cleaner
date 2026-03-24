import * as vscode from "vscode";

class Logger {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("C++ Unused Includes Remover");
  }

  info(message: string): void {
    this.log("INFO", message);
  }

  warn(message: string): void {
    this.log("WARN", message);
  }

  error(message: string): void {
    this.log("ERROR", message);
    this.channel.show(true);
  }

  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    this.channel.appendLine(`[${timestamp}] [${level}] ${message}`);
  }
}

export const logger = new Logger();
