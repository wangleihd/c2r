import * as vscode from "vscode";
import * as path from "path";
import * as fs from 'fs';

import { getNonce } from "./tools";
import { sendToFile2 } from "./api";

export class SidebarProvider implements vscode.WebviewViewProvider {
    constructor(protected context: vscode.ExtensionContext) { }

    private _view?: vscode.WebviewView;
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
        await this.updateWebview();

        // Handle messages from the Webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openInputFile':
                    const fileInputPath = message.filePath;
                    const inputDocument = await vscode.workspace.openTextDocument(fileInputPath);
                    vscode.window.showTextDocument(inputDocument, { viewColumn: vscode.ViewColumn.One });
                    break;
                case 'openOutputFile':
                    const fileOutputPath = message.filePath;
                    const outputDocument = await vscode.workspace.openTextDocument(fileOutputPath);
                    vscode.window.showTextDocument(outputDocument, { viewColumn: vscode.ViewColumn.Two });
                    break;
                case 'selectInputDirectory':
                    const inputDir = await this.selectDirectory();
                    if (inputDir) {
                        this.inputDirectory = inputDir;
                        this.input = inputDir;
                        await this.showFileList();
                        this.updateInput();
                    }
                    break;
                case 'selectOutputDirectory':
                    const outputDir = await this.selectDirectory();
                    if (outputDir) {
                        this.outputDirectory = outputDir;
                        this.output = outputDir;
                        await this.showFileList();
                        this.updateOutput();
                    }
                    break;
                case 'processFiles':
                    if (!this.inputDirectory) {
                        vscode.window.showErrorMessage("请先设置输入目录。");
                        return;
                    }
                    if (!this.outputDirectory) {
                        vscode.window.showErrorMessage("请先设置输出目录。");
                        return;
                    }
                    await this.simulateFileProcessing(this.inputDirectory, this.outputDirectory);
                    break;
            }
        });
    }

    private async showFileList() {


        if (this.inputDirectory) {
            this.inputFileTree = await this.inputFileTreeFun();
        }
        if (this.outputDirectory) {
            this.outputFileTree = await this.outputFileTreeFun();
        }
        if (this._view) {
            this._view.webview.html = this.getHtmlForWebview(
                this._view.webview,
                this.inputFileTree,
                this.outputFileTree,
            );
        }
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
        if (this._view) {
            this._view.webview.postMessage({ command: 'startLoading' });
        }
        vscode.window.showInformationMessage(`项目进行分析中...`);
        setTimeout(() => {
            vscode.window.showInformationMessage('');
        }, 3000);
        const inputdirPath = path.join(this.currentWorkspaceRoot, inputDir);
        const outputDirPath = path.join(this.currentWorkspaceRoot, outputDir);

        const lists = this.processFilesInDirectory(inputdirPath);
        vscode.window.showInformationMessage(`项目进行转化中...`);
        for (const item of lists) {
            await this.processFileToAPI(inputdirPath, outputDirPath,item);
        }
        vscode.window.showInformationMessage(`项目转化完成！`);
        if (this._view) {
            this._view.webview.postMessage({ command: 'stopLoading' });
        }

    }
    private findIncludes(content: string): string[] {
        // const regex = /#include\s+"(.+\.h)"/g;
        const regex = /#include\s+"(.+)\.h"/g;
        const includes = [];
        let match;

        while ((match = regex.exec(content)) !== null) {
            includes.push(match[1]);
        }
        return includes;
    }

    private processFilesInDirectory(inputDir: string, dir = "", lists: { projectName: string; fileName: string; includes: string[] }[] =[]): { projectName: string; fileName: string; includes: string[] }[] {
        const files = fs.readdirSync(inputDir);
        files.forEach(file => {
            if (!file.startsWith('.')) {
                const filePath = path.join(inputDir, file);
                if (fs.statSync(filePath).isDirectory()) {
                    this.processFilesInDirectory(filePath, file, lists);
                } else if (file.startsWith('test-') && file.endsWith('.c')) {
                    const projectName = file.replace('test-', '').replace('.c', '');
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    const includes = this.findIncludes(fileContent);
                    const fileName = dir ? path.join(dir, file) : file;
                    lists.push({
                        projectName,
                        fileName,
                        includes,
                    });
                }
            }    
        });
        return lists;
    }


    private async processFileToAPI(inputDir: string, outputDir: string, item: { projectName: string; fileName: string; includes: string[] }): Promise<void> {
        const context:{path: string; code: string}[] = [];
        try {
            await Promise.all(item.includes.map(async (f) => {
                const  lists = await this.findfilsInDir(inputDir, f);
                lists.forEach(element => {
                    const filePath = path.join(inputDir, element); // 获取完整路径
                    const fileContent = fs.readFileSync(filePath, 'utf-8'); // 读取文件内容
                    context.push({
                        "path": element, // 获取相对路径
                        "code": fileContent, // 文件内容
                    });
                });
                const mainContent = fs.readFileSync(path.join(inputDir, item.fileName), 'utf-8');
                context.push({
                    "path": item.fileName, // 获取相对路径
                    "code": mainContent, // 文件内容
                });
                const body = { // 输入目录的名称作为项目名
                    "projectName": item.projectName,
                    "content":  context,
                };
    
                // 3. 调用 API
                const response = await sendToFile2(body);
                const { data } = response;
    
                if (data || data.status === 0) {
                    if (data.output?.length > 0) {
                        // 4. 处理 API 响应
                        const output = path.join(outputDir, 'main');
    
                        await this.createFilesFromOutput(data.output, output);
                    }
                } else {
                    throw new Error(`API请求失败：${response.statusText}`);
                }
                console.log('Response:', response.data);
            }));
        } catch (error) {
            console.error('Error during API request:', error);
            vscode.window.showErrorMessage(`Error processing files: ${error}`);
        }
    }

    private async findfilsInDir(inputDir: string, filename: string, dir = "", lists: string[] = []): Promise<string[]> {
        const files = fs.readdirSync(inputDir);
        files.forEach(file => {
            if (!file.startsWith('.')) {
                const filePath = path.join(inputDir, file);
                if (fs.statSync(filePath).isDirectory()) {
                    this.findfilsInDir(filePath, filename, file, lists);
                } else if (file.startsWith(filename) && (file.endsWith('.c') || file.endsWith('.h'))) {
                    const findname = dir ? path.join(dir, file) : file;
                    lists.push(findname);
                }
            }    
        });        
        return lists;
    }

    // find file in input dir, return the file path
    private async createFilesFromOutput(output: { path: string; code: string }[], outputDir: string) {
        try {
            await this.clearOutputDir(outputDir);
            for (const file of output) {
                const filePath = path.join(outputDir, file.path);

                // 确保父目录存在
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                // 创建文件并写入内容
                await fs.promises.writeFile(filePath, file.code, 'utf8');
            }
            this.updateWebview();
        } catch (error) {
            console.error('创建文件出错:', error);
            vscode.window.showErrorMessage(`创建文件失败: ${error}`);
        }
    }

    private async clearOutputDir(outputDir: string) {
        return new Promise<void>((resolve, reject) => {
            fs.rm(outputDir, { recursive: true, force: true }, (err) => {
                if (err) {
                    console.error('清除目录出错:', err.message);
                    return reject(err);
                }
                console.log(`目录 ${outputDir} 已成功清除。`);
                this.updateWebview();
                resolve();
            });
        });
    }
    private async updateWebview(): Promise<void> {
        await this.showFileList();
        this.updateOutput();
    }


    private updateInput(): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateinput',
                inputDirectory: this.inputDirectory
            });
        }
    }
    private updateOutput(): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateoutput',
                outputDirectory: this.outputDirectory
            });
        }
    }

    private async inputFileTreeFun(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.currentWorkspaceRoot = workspaceFolders[0].uri.fsPath;
        }
        const fileTree = await this.buildFileTree(this.input);
        if (this.currentWorkspaceRoot && this.inputDirectory.startsWith(this.currentWorkspaceRoot)) {
            this.inputDirectory = path.relative(this.currentWorkspaceRoot, this.input);
        }
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
                    <details data-path="${fullPath}" onclick="handleDetailsClick()" class="directory">
                        <summary><span class="icondir fa-solid fa-folder dir"></span>
                        <span class="dirname">${name}</span></summary>
                        ${subTree}
                    </details>
                `;
            })
        );

        // 构建文件部分
        const fileTree = files.map(([name]) => {
            const ext = path.extname(name).toLowerCase().slice(1);
            let iconClass = 'fa-solid fa-file f';
            if (ext === 'c' || ext === 'cpp') {
                iconClass = 'fa-solid fa-c c';
            } else if (ext === 'h') {
                iconClass = 'fa-solid fa-h h';
            } else if (ext === 'rs') {
                iconClass = 'fa-brands fa-rust rust';
            }
            const fullPath = path.join(dir, name);
            return `
                <div class="file" data-path="${fullPath}">
                    <span class="icon ${iconClass}"></span>
                    ${name}
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
        const fileTree = await this.buildFileTree(this.output);
        if (this.currentWorkspaceRoot && this.outputDirectory.startsWith(this.currentWorkspaceRoot)) {
            this.outputDirectory = path.relative(this.currentWorkspaceRoot, this.output);
        }
        return fileTree;
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
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.1/css/all.min.css">
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
                .main {
                }
                #out-container {
                    overflow-y: auto; /* 超出内容滚动 */
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
                    font-size: 12px;
                    cursor: pointer;
                    color: #ccc;
                }

                .file:hover {
                   color: #eee;
                 }
                .file.input-selected {
                    font-weight: bold;
                    color: #7B76FFFF;
                }
                .file.output-selected {
                    font-weight: bold;
                    color: #FE8930FF;
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

                
                
                .icon {
                    display: inline-block;
                    vertical-align: middle;
                    margin-right: 3px;
                    margin-top: 3px;
                    margin-bottom: 3px;
                    margin-left: 20px;
                }
                .c {
                    color: #59ADFBFF;
                }
                .h {
                    color: #A089F4FF;
                }
                .rust {
                    color: #FE8930FF;
                }
                .f {
                    color: #dedede;
                }
                .icondir {
                    display: inline-block;
                    vertical-align: middle;
                    margin: 3px;
                }
                .dir {
                    color:  #FEB807FF
                }
                
                .dirname {
                    color: #C8C8C8C8;
                    font-size: 12px;
                }
                .dirname:hover {
                    color: #eee;
                    font-weight: bold;
                }
                
                /* 修改 summary 样式 */
                .directory {
                    padding-left: 10px
                }
                .directory > summary {
                    cursor: pointer;
                    font-weight: bold;
                }
                .directory > summary:hover {
                    color: #eee;
                    font-weight: bold;
                }
                .directory > .file {
                    margin-left: 10px;
                }

                .main {
                    margin: 0 10px;
                    height: 100%;
                }
                .btn {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    text-align: center;
                    margin-bottom: 10px;
                }
                #selectInputButton {
                    width: 35%;
                    font-size: 12px;
                }
                .btniconc {
                    color: #59ADFBFF;
                    margin: 5px;
                }
                .toicon {
                    width: 5%;
                    font-size: 14px;
                    font-weight: bold;
                }
                .btniconr {
                    color: #FE8930FF;
                    margin: 5px;
                }
                #selectOutputButton {
                    width: 35%;
                    font-size: 12px;
                }

                .input {
                    height: 50%;
                    display: flex;
                    flex-direction: column;
                    background-color: #303030;
                    border-radius: 6px;
                    border: 1px solid #444;
                }
                .inputdir {
                    margin: 8px;
                    font-size: 12px;
                    height: 20px;
                }
                .path-display {
                    margin: 3px;
                    font-size: 10px;
                    color: #dedede;
                }
                .inputmiddle {
                    flex-grow: 1;
                    overflow-y: auto;
                }
                .tobtn{
                    height: 20px;
                    text-align: end;
                    margin: 8px;
                    margin-bottom: 12px;
                }

                .btnto {
                    color: #4B45FFFF;
                    margin-right: 2px;
                }
                #processButton{
                    font-size: 12px !important;
                    padding: 2px 10px;
                }

                /* 旋转动画 */
                .spinner {
                    transition: transform 0.3s ease;
                }
                .spinner-animate {
                    animation: spin 2s linear infinite;
                }


                /* 定义旋转动画 */
                @keyframes spin {
                    from {
                        transform: rotate(0deg);
                    }
                    to {
                        transform: rotate(360deg);
                    }
                }

                #container {
                    overflow-y: auto; /* 超出内容滚动 */
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
                

                .line {
                    margin: 10px 0;
                    height: 1px;
                    background-color: #666;
                }
                
                .output {
                    height: 40%;
                    display: flex;
                    flex-direction: column;
                    background-color: #303030;
                    border-radius: 6px;
                    border: 1px solid #444;
                }
                .bside{
                    height: 8px;
                    margin-top: 10px;
                }
            </style>
        </head>
        <body>
            <div class="main">
                <div class="btn">
                    <button id="selectInputButton"><i class="btniconc fa-solid fa-c"></i>输入目录</button>
                    <div class="toicon">
                    <i class="fa-solid fa-right-long"></i>
                    </div>
                    <button id="selectOutputButton"><i class="btniconr fa-brands fa-rust"></i>输出目录</button> 
                </div>
                <div class="input">
                    <div class="inputdir">输入目录:<span id="inputPath" class="path-display">No directory selected</span></div>
                    <div class="inputmiddle">
                        <div id="container">${inputFileTree}</div>
                    </div>
                    <div class="tobtn"><button id="processButton" class="process-btn">
                        <i class="btnto spinner fa-solid fa-arrows-rotate"></i>
                        <span class="button-text">转换</span>
                    </button></div>
                </div>
                <div class="line"></div>
                <div class="output">
                <div class="inputdir">输出目录:<span id="outputPath" class="path-display">No directory selected</span></div>
                    <div class="inputmiddle">
                    <div id="out-container">${outputFileTree}</div>
                    </div>
                    <div class="bside"></div>
                </div>
            </div>


            
            

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
                    const { command, inputDirectory } = event.data;
                    if (command === 'updateinput') {
                        inputPath.textContent = inputDirectory || 'No directory selected';
                    }
                });
                window.addEventListener('message', (event) => {
                    const { command, outputDirectory } = event.data;
                    if (command === 'updateoutput') {
                        outputPath.textContent = outputDirectory || 'No directory selected';
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
                        vscode.postMessage({ command: 'openInputFile', filePath });
                    }
                    if (element.classList.contains('dirname')) {
                        if (element.closest('summary')) {
                            const summary = element.closest('summary');
                            const details = summary.parentElement; // 获取 <details> 元素
                            if (details && details instanceof HTMLDetailsElement) {
                                const icon = summary.querySelector('.icondir');
                                if (icon) {
                                    const isOpen = details.open; // 检查 <details> 的打开状态
                                    icon.classList.remove('fa-folder', 'fa-folder-open');
                                    icon.classList.add(!isOpen ? 'fa-folder-open' : 'fa-folder');
                                }
                            }
                        }

                    }
                });
                document.getElementById('container').querySelectorAll('summary').forEach((summary) => {
                    summary.addEventListener('click', (event) => {
                        const details = summary.parentElement; // 获取 <details> 元素
                        if (details && details instanceof HTMLDetailsElement) {
                            const icon = summary.querySelector('.icondir');
                            if (icon) {
                                const isOpen = details.open; // 检查 <details> 的打开状态
                                icon.classList.remove('fa-folder', 'fa-folder-open');
                                icon.classList.add(!isOpen ? 'fa-folder-open' : 'fa-folder');
                            }
                        }
                    });
                });
                document.getElementById('out-container').addEventListener('click', (event) => {
                    const element = event.target;
                    if (element.classList.contains('file')) {
                        const filePath = element.dataset.path;
                        document.querySelectorAll('#out-container .file.output-selected').forEach((file) => {
                            file.classList.remove('output-selected');
                        });
                        element.classList.add('output-selected');
                        vscode.postMessage({ command: 'openOutputFile', filePath });
                    }
                    if (element.classList.contains('dirname')) {
                        if (element.closest('summary')) {
                            const summary = element.closest('summary');
                            const details = summary.parentElement; // 获取 <details> 元素
                            if (details && details instanceof HTMLDetailsElement) {
                                const icon = summary.querySelector('.icondir');
                                if (icon) {
                                    const isOpen = details.open; // 检查 <details> 的打开状态
                                    icon.classList.remove('fa-folder', 'fa-folder-open');
                                    icon.classList.add(!isOpen ? 'fa-folder-open' : 'fa-folder');
                                }
                            }
                        }
                    }
                });

                document.getElementById('out-container').querySelectorAll('summary').forEach((summary) => {
                    summary.addEventListener('click', (event) => {
                        const details = summary.parentElement; // 获取 <details> 元素
                        if (details && details instanceof HTMLDetailsElement) {
                            const icon = summary.querySelector('.icondir');
                            if (icon) {
                                const isOpen = details.open; // 检查 <details> 的打开状态
                                icon.classList.remove('fa-folder', 'fa-folder-open');
                                icon.classList.add(!isOpen ? 'fa-folder-open' : 'fa-folder');
                            }
                        }
                    });
                });
                window.addEventListener('message', (event) => {
                    const { command } = event.data;

                    const inputBTN = document.getElementById('selectInputButton');
                    const outputBTN = document.getElementById('selectOutputButton');
                    const processBTN = document.getElementById('processButton');
                    const spinnerIcon = processBTN.querySelector('.spinner');
                    const buttonText = processBTN.querySelector('.button-text');

                    if (command === 'startLoading') {
                        inputBTN.disabled = true; // 禁用按钮
                        outputBTN.disabled = true; // 禁用按钮
                        processBTN.disabled = true; // 禁用按钮
                        spinnerIcon.classList.add('spinner-animate'); // 开始动画
                        buttonText.textContent = '转换中...'; // 修改按钮文字
                    } else if (command === 'stopLoading') {
                        inputBTN.disabled = false; // 启用按钮
                        outputBTN.disabled = false; // 启用按钮
                        processBTN.disabled = false; // 启用按钮
                        spinnerIcon.classList.remove('spinner-animate'); // 停止动画
                        buttonText.textContent = '转换'; // 恢复按钮文字
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
        </html>
        `;
    }
}
