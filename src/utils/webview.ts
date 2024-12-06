import * as vscode from "vscode";
import * as path from "path";
import * as fs from 'fs';
import { sendToFile2 } from './api';
import {getNonce} from "./tools";


export class SidebarProvider implements vscode.WebviewViewProvider {
    constructor(protected context: vscode.ExtensionContext) { }

    private _view?: vscode.WebviewView;
    private rootDir: string = '';
    private currentWorkspaceRoot: string = '';
    private inputDirectory: string = '';
    private outputDirectory: string = '';
    private inputFileTree: string = '';
    private outputFileTree: string = '';
    private input: string = '';
    private output: string = '';


    public async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };
        this.rootDir =  await this.generateFileTree();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.currentWorkspaceRoot = workspaceFolders[0].uri.fsPath; // 设置初始目录为工作区根目录
        } else {
            const selectedDirectory = await this.selectDirectory(); // 提示用户选择目录
            if (selectedDirectory) {
                this.currentWorkspaceRoot = selectedDirectory;
            } else {
                vscode.window.showErrorMessage("请打开一个工作区或选择一个目录作为初始目录。");
                return; // 如果用户没有选择目录，终止加载 Webview
            }
        }

        // Generate the initial file tree
        webviewView.webview.html = this.getHtmlForWebview(
            webviewView.webview,
            '',
            '',
        );

        // Handle messages from the Webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openFile':
                    const filePath = message.filePath;
                    const document = await vscode.workspace.openTextDocument(filePath);
                    vscode.window.showTextDocument(document);
                    break;
                case "transformFile":
                    const updatedInputTree = await this.generateFileTree();
                    webviewView.webview.postMessage({
                        command: "transformFile",
                        fileTree: updatedInputTree,
                    });
                    break;
                case 'selectInputDirectory':
                    const inputDir = await this.selectDirectory();
                    if (inputDir) {
                        this.inputDirectory = inputDir;
                        this.input = inputDir;
                        await this.showFileList(webviewView);
                        this.updateWebview();
                    }
                    break;
                case 'selectOutputDirectory':
                    const outputDir = await this.selectDirectory();
                    if (outputDir) {
                        this.outputDirectory = outputDir;
                        this.output = outputDir;
                        await this.showFileList(webviewView);
                        this.updateWebview();
                    }
                    break;
                case 'processFiles':
                    if (this.inputDirectory && this.outputDirectory) {
                        await this.simulateFileProcessing(this.inputDirectory, this.outputDirectory);
                    }
                    break;
                case "createDirectory":
                    await this.createDirectory(message.parentPath, message.newDirName);
                    const refreshedTree = await this.generateFileTree();
                    webviewView.webview.postMessage({
                        command: "updateOutputTree",
                        fileTree: refreshedTree,
                    });
                    break;
            }
        });
    }

    private async showFileList(webviewView: vscode.WebviewView) {

        if(this.inputDirectory ){
            this.inputFileTree = await this.inputFileTreeFun();
        }
        if (this.outputDirectory) {
            this.outputFileTree = await this.outputFileTreeFun();
        }
        webviewView.webview.html = this.getHtmlForWebview(
            webviewView.webview,
            this.inputFileTree,
            this.outputFileTree,
        );
    }
    private async selectDirectory(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let defaultDirectory = '';

        if (workspaceFolders && workspaceFolders.length > 0) {
            defaultDirectory = workspaceFolders[0].uri.fsPath;
        }

        const selected = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Directory',
            defaultUri: vscode.Uri.file(defaultDirectory),
        });
        return selected?.[0]?.fsPath;
    }

    private async simulateFileProcessing(inputDir: string, outputDir: string): Promise<void> {
        vscode.window.showInformationMessage(`Processing files start ...`);
        const files = fs.readdirSync(inputDir);
        for (const file of files) {
            const filePath = path.join(inputDir, file);
            const fileContent = fs.createReadStream(filePath);
            const formData = new FormData();

            // Append file to formData
            formData.append('file', fileContent, file);

            // Send file to backend
            await this.postFileToServer(filePath, formData as any);
        }
        vscode.window.showInformationMessage(`Processing completed.`);
    }
    private async postFileToServer(filename: string, fileContent: Buffer): Promise<void>   {
        try {
            const response = await sendToFile2(fileContent);
    
            if (response.status === 200) {
                console.log(`文件 ${filename} 发送成功`);
            } else {
                console.warn(`文件 ${filename} 发送失败，服务器响应：`, response.data);
            }
        } catch (error) {
            console.error(`文件 ${filename} 发送失败：`, error);
        }    
    }

    private updateWebview(): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateDirectories',
                inputDirectory: this.inputDirectory,
                outputDirectory: this.outputDirectory,
                isProcessEnabled: Boolean(this.inputDirectory && this.outputDirectory),
            });
        }
    }

    private async generateFileTree(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.currentWorkspaceRoot = workspaceFolders[0].uri.fsPath;
        }
        const fileTree = await this.buildFileTree(this.currentWorkspaceRoot);

        return fileTree;
    }

    private async buildFileTree(dir: string, depth = 0): Promise<string> {
        // 读取目录内容并过滤掉隐藏文件和目录
        const entries = (
            await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir))
        ).filter(([name]) => !name.startsWith("."));

        // 分离目录和文件
        const directories = entries.filter(
            ([_, type]) => type === vscode.FileType.Directory
        );
        const files = entries.filter(([_, type]) => type === vscode.FileType.File);

        // 构建目录部分
        const directoryTree = await Promise.all(
            directories.map(async ([name]) => {
                const fullPath = path.join(dir, name);
                const subTree = await this.buildFileTree(fullPath, depth + 1);
                return `
                    <details onclick="handleDetailsClick()" class="directory">
                        <summary><span class="icon folder-icon"></span>${name}</summary>
                        ${subTree}
                    </details>
                `;
            })
        );

        // 构建文件部分
        const fileTree = files.map(([name]) => {
            const fullPath = path.join(dir, name);
            return `
                <div class="file" data-path="${fullPath}">
                    <span class="icon file-icon"></span>${name}
                </div>
            `;
        });

        // 合并目录和文件部分
        return [...directoryTree, ...fileTree].join("");
    }

    private async inputFileTreeFun(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.currentWorkspaceRoot = workspaceFolders[0].uri.fsPath;
        }
        const fileTree = await this.inputBuildFileTree(this.input);
        if (this.currentWorkspaceRoot && this.inputDirectory.startsWith(this.currentWorkspaceRoot)) {
            this.inputDirectory = path.relative(this.currentWorkspaceRoot, this.input);
        }
        return fileTree;
    }

    private async inputBuildFileTree(dir: string, depth = 0): Promise<string> {
        // 读取目录内容并过滤掉隐藏文件和目录
        const entries = (
            await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir))
        ).filter(([name]) => !name.startsWith("."));

        // 分离目录和文件
        const directories = entries.filter(
            ([_, type]) => type === vscode.FileType.Directory
        );
        const files = entries.filter(([_, type]) => type === vscode.FileType.File);

        // 构建目录部分
        const directoryTree = await Promise.all(
            directories.map(async ([name]) => {
                const fullPath = path.join(dir, name);
                const subTree = await this.buildFileTree(fullPath, depth + 1);
                return `
                    <details onclick="handleDetailsClick()" class="directory">
                        <summary><span class="icon folder-icon"></span>${name}</summary>
                        ${subTree}
                    </details>
                `;
            })
        );

        // 构建文件部分
        const fileTree = files.map(([name]) => {
            const fullPath = path.join(dir, name);
            return `
                <div class="file" data-path="${fullPath}">
                    <span class="icon file-icon"></span>${name}
                </div>
            `;
        });

        // 合并目录和文件部分
        return [...directoryTree, ...fileTree].join("");
    }

    private async outputFileTreeFun(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.currentWorkspaceRoot = workspaceFolders[0].uri.fsPath;
        }
        const fileTree = await this.outputBuildFileTree(this.output);
        if (this.currentWorkspaceRoot && this.outputDirectory.startsWith(this.currentWorkspaceRoot)) {
            this.outputDirectory = path.relative(this.currentWorkspaceRoot, this.output);
        }
        return fileTree;
    }
    private async outputBuildFileTree(dir: string, depth = 0): Promise<string> {
        // 读取目录内容并过滤掉隐藏文件和目录
        const entries = (
            await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir))
        ).filter(([name]) => !name.startsWith("."));

        // 分离目录和文件
        const directories = entries.filter(
            ([_, type]) => type === vscode.FileType.Directory
        );
        const files = entries.filter(([_, type]) => type === vscode.FileType.File);

        // 构建目录部分
        const directoryTree = await Promise.all(
            directories.map(async ([name]) => {
                const fullPath = path.join(dir, name);
                const subTree = await this.buildFileTree(fullPath, depth + 1);
                return `
                    <details onclick="handleDetailsClick()" class="directory">
                        <summary><span class="icon folder-icon"></span>${name}</summary>
                        ${subTree}
                    </details>
                `;
            })
        );

        // 构建文件部分
        const fileTree = files.map(([name]) => {
            const fullPath = path.join(dir, name);
            return `
                <div class="file" data-path="${fullPath}">
                    <span class="icon file-icon"></span>${name}
                </div>
            `;
        });

        // 合并目录和文件部分
        return [...directoryTree, ...fileTree].join("");
    }


    private async createDirectory(
        parentPath: string,
        newDirName: string
    ): Promise<void> {
        const newDirPath = path.join(parentPath, newDirName);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(newDirPath));
        vscode.window.showInformationMessage(`Directory created: ${newDirPath}`);
    }

   private getHtmlForWebview(
        webview: vscode.Webview,
        inputFileTree: string,
        outputFileTree: string,
    ): string {
        const nonce = getNonce();

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>File Explorer</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 0;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }
                #container {
                    height: 45%; /* 固定高度为 40% */
                    overflow-y: auto; /* 超出内容滚动 */
                    margin: 0 5px;
                    padding: 5px;
                    border-radius: 3px;
                    background-color: #404040;
                }
                #container::-webkit-scrollbar {
                    width: 8px;
                }
                #container::-webkit-scrollbar-thumb {
                    background-color: #888;
                    border-radius: 4px;
                }
                #container::-webkit-scrollbar-thumb:hover {
                    background-color: #555;
                }

                #out-container {
                    height: 45%; /* 固定高度为 40% */
                    overflow-y: auto; /* 超出内容滚动 */
                    margin: 0 5px;
                    padding: 5px;
                    border-radius: 3px;
                    background-color: #303030;
                }
                #out-container::-webkit-scrollbar {
                    width: 8px;
                }
                #out-container::-webkit-scrollbar-thumb {
                    background-color: #888;
                    border-radius: 4px;
                }
                #out-container::-webkit-scrollbar-thumb:hover {
                    background-color: #555;
                }
                .text {
                    margin: 0 5px;
                    padding: 5px;
                    background-color: #404040;
                    margin-bottom: 1px;
                }
                .out-text {
                    margin: 0 5px;
                    padding: 5px;
                    margin-bottom: 1px;
                    background-color: #303030;
                }
                .file {
                    cursor: pointer;
                    color: #dedede;
                    margin-left: 10px;
                    margin-bottom: 1px;
                }
                .file:hover {
                    text-decoration: underline;
                }
                .file:focus {
                    
                } 
                .file.input-selected {
                    font-weight: bold;
                    color: #7B76FFFF;
                }

                .file.output-selected {
                    font-weight: bold;
                    color: #FE8930FF;
                }
                .directory {
                    padding-left: 10px
                }
                .directory > summary {
                    cursor: pointer;
                    font-weight: bold;
                    margin-bottom: 1px;
                    color: #dedede;
                }
                .directory > summary:hover {
                    text-decoration: underline;
                }
                .section {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin: 10px 5px;
                }
                .line {
                    height: 1px;
                    background-color: #ccc;
                    padding: 0 3px;
                }
                .path-display {
                    margin-top: 3px;
                    font-size: 12px;
                    color: #dedede;
                }
                .directory {
                    padding-left: 10px
                }
                .directory > summary {
                }
                .directory {
                    padding-left: 10px
                }
                .directory > summary {
                    cursor: pointer;
                    font-weight: bold;
                    margin-bottom: 1px;
                    color: #;
                }
                #processButton{
                    width: 40%;
                    background: #5E59FBFF;
                    color: #fff;
                }
                #selectInputButton{
                    width: 28%;
                }
                #selectOutputButton {
                    width: 28%;
                }
                .directory > summary:hover {
                    text-decoration: underline;
                }
                .icon {
                    display: inline-block;
                    vertical-align: middle;
                    margin-right: 2px;
                }
                .folder-icon {
                    background: url('https://example.com/folder-icon.png') no-repeat center center;
                    background-size: contain;
                }
                .file-icon {
                    background: url('https://example.com/file-icon.png') no-repeat center center;
                    background-size: contain;
                }
            </style>
        </head>
        <body>
            <div class="text">
                <div>输入目录:</div>
                <div id="inputPath" class="path-display">No directory selected</div>
            </div>
            <div id="container">${inputFileTree}</div>
            <div class="section">
                <button id="selectInputButton">选择输入目录</button>
                <button id="processButton" disabled>转成 Rust </button>
                <button id="selectOutputButton">选择输出目录</button>
            </div>
            <div class="out-text">
            <div>输出目录:</div>
            <div id="outputPath" class="path-display">No directory selected</div>
            </div>
            <div id="out-container">${outputFileTree}</div>


            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                const inputButton = document.getElementById('selectInputButton');
                const outputButton = document.getElementById('selectOutputButton');
                const processButton = document.getElementById('processButton');
                const inputPath = document.getElementById('inputPath');
                const outputPath = document.getElementById('outputPath');

                inputButton.addEventListener('click', () => {
                    vscode.postMessage({ command: 'selectInputDirectory' });
                });

                outputButton.addEventListener('click', () => {
                    vscode.postMessage({ command: 'selectOutputDirectory' });
                });

                processButton.addEventListener('click', () => {
                    vscode.postMessage({ command: 'processFiles' });
                });

                window.addEventListener('message', (event) => {
                    const { command, inputDirectory, outputDirectory, isProcessEnabled } = event.data;

                    if (command === 'updateDirectories') {
                        inputPath.textContent = inputDirectory || 'No directory selected';
                        outputPath.textContent = outputDirectory || 'No directory selected';
                        processButton.disabled = !isProcessEnabled;
                    }
                });

                document.getElementById('container').addEventListener('click', (event) => {
                    const element = event.target;
                    if (element.classList.contains('file')) {
                        const filePath = element.dataset.path;
                        document.querySelectorAll('#container .file.input-selected').forEach((file) => {
                            file.classList.remove('input-selected');
                        });
                        element.classList.add('input-selected');
                        vscode.postMessage({ command: 'openFile', filePath });
                    }
                });

                document.getElementById('out-container').addEventListener('click', (event) => {
                    const element = event.target;
                    if (element.classList.contains('file')) {
                        const filePath = element.dataset.path;
                        document.querySelectorAll('#out-container .file.output-selected').forEach((file) => {
                            file.classList.remove('output-selected');
                        });
                        element.classList.add('output-selected');
                        vscode.postMessage({ command: 'openFile', filePath });
                    }
                });


                function getSelectedPath(containerId) {
                    const container = document.getElementById(containerId);
                    const selected = container.querySelector('.selected');
                    return selected ? selected.dataset.path : null;
                }

                document.body.addEventListener('click', (event) => {
                    if (event.target.classList.contains('file') || event.target.classList.contains('directory-summary')) {
                        clearSelection();
                        event.target.classList.add('selected');
                    }
                });

                function clearSelection() {
                    document.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
                }
            </script>
        </body>
        </html>`;
    }
    
}
