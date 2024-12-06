import * as vscode from 'vscode';
import * as path from 'path';

export class FileExplorer implements vscode.TreeDataProvider<FileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | void> =
        new vscode.EventEmitter<FileItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string | undefined) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileItem): Promise<FileItem[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No workspace open');
            return Promise.resolve([]);
        }

        const dir = element ? element.resourceUri.fsPath : this.workspaceRoot;
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));

        return entries.map(([name, type]) => {
            const resourceUri = vscode.Uri.file(path.join(dir, name));
            const isDirectory = type === vscode.FileType.Directory;

            return new FileItem(
                name,
                resourceUri,
                isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                isDirectory ? 'folder' : 'file'
            );
        });
    }
}

class FileItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
        this.tooltip = this.resourceUri.fsPath;
        this.command =
            contextValue === 'file'
                ? {
                      command: 'fileExplorer.openFile',
                      title: 'Open File',
                      arguments: [this.resourceUri],
                  }
                : undefined;
    }
}