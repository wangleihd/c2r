// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SidebarProvider } from './utils/webview';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const sidebaer = new SidebarProvider(context);
	const showSideber = vscode.window.registerWebviewViewProvider('c2r-sidebar-view', sidebaer);
	context.subscriptions.push(showSideber);
}

// This method is called when your extension is deactivated
export function deactivate() {}
