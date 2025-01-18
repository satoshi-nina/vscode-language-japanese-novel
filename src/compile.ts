import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getConfig } from "./config";
import { deadLineFolderPath } from "./extension";
import TreeModel from "tree-model";

//fsモジュールの使い方 https://qiita.com/oblivion/items/2725a4b3ca3a99f8d1a3
export default function compileDocs(): void {
  const projectName =
    deadLineFolderPath() == ""
      ? vscode.workspace.workspaceFolders?.[0].name
      : vscode.workspace.workspaceFolders?.[0].name +
      "-" +
      path.basename(deadLineFolderPath());
  const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  const config = getConfig();
  const separatorString = "\n\n" + config.separator + "\n\n";
  const draftRootPath =
    deadLineFolderPath() == "" ? draftRoot() : deadLineFolderPath();

  console.log("ProjectName: ", projectName);
  console.log("締め切りフォルダー", deadLineFolderPath());

  //      publishフォルダがなければ作る
  if (!fs.existsSync(projectPath + "/publish")) {
    fs.mkdirSync(projectPath + "/publish");
  }

  //#region BLANK
  //  空のファイルをつくる
  const fileExtension = config.draftFileType;
  const compiledTextFilePath = projectPath + "/publish/" + projectName + fileExtension;
  try {
    fs.writeFileSync(compiledTextFilePath, "");
  } catch (err) {
    console.log("ファイル書き込み時のエラー", err);
  }

  //  テキストを書き込む
  const filelist = getFileList(draftRootPath).files;

  function generateText(
    fileOrDir: FileOrDir,
    hasSubDir: boolean,
    isFirstInDir: boolean,
  ): string[] {
    const result: string[] = [];
    if (fileOrDir instanceof File) {
      if (!isFirstInDir && !hasSubDir) {
        console.log("add *:" + fileOrDir.filepath + hasSubDir);
        result.push(separatorString);
      }
      const content = fs.readFileSync(fileOrDir.filepath, "utf8");
      // 前後の空白行を削除
      const contentTrim = content.replace(/^\s+|\s+$/g, '');
      result.push(contentTrim);
    }
    if (fileOrDir instanceof Dir) {
      const content = fileOrDir.files.flatMap((e, index) => generateText(
        e,
        fileOrDir.hasSubDir,
        index == 0,
      ));
      // 前後に空白行を追加
      const contentWrapBlank = ["\n\n", ...content, "\n\n"];
      result.splice(result.length, 0, ...contentWrapBlank);
    }
    return result;
  }

  // 同じ階層にサブディレクトリがあるかどうか
  const hasSubDir = filelist.some((e) => e instanceof Dir);

  const content = filelist.reduce((prev: string, listItem: FileOrDir, index: number) => {
    const text = generateText(
      listItem,
      hasSubDir,
      index == 0,
    );
    return [prev, ...text].join("");
  },
    "",
  );

  // 前後の空白行を削除
  const contentTrim = content.replace(/^\s+|\s+$/g, '');
  fs.appendFileSync(compiledTextFilePath, contentTrim);
  //console.log(fileList(draftRootPath, 0).files);
}

export function draftRoot(): string {
  if (
    vscode.workspace.name == undefined ||
    vscode.workspace.workspaceFolders == undefined
  ) {
    return "";
  } else {
    const projectPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    let draftRootPath = projectPath;
    const projectFiles = fs.readdirSync(projectPath);
    //「原稿」あるいは「Draft」フォルダーを原稿フォルダのルートにする。
    if (
      projectFiles.includes("Draft") &&
      fs.statSync(projectPath + "/Draft").isDirectory()
    ) {
      draftRootPath = draftRootPath + "/Draft";
    } else if (
      projectFiles.includes("原稿") &&
      fs.statSync(projectPath + "/原稿").isDirectory()
    ) {
      draftRootPath = draftRootPath + "/原稿";
    }

    return draftRootPath;
  }
}

abstract class FileOrDir {
  constructor(
    public dir: string,
    public name: string,
    public charCount: number,
  ) { }

  get filepath(): string {
    return path.join(this.dir, this.name).normalize('NFC');
  }
}

class File extends FileOrDir {
  constructor(
    dir: string,
    name: string,
    charCount: number,
  ) {
    super(dir, name, charCount);
  }
};

class Dir extends FileOrDir {
  constructor(
    dir: string,
    name: string,
    public files: FileOrDir[],
  ) {
    const charCount = files.reduce((prev: number, current: FileOrDir) => prev + current.charCount, 0);
    super(dir, name, charCount);
  }

  get hasSubDir(): boolean {
    return this.files.some((e) => e instanceof Dir);
  }
}

type FileList = {
  label: string;
  files: FileOrDir[];
  flattenFiles: File[];
  length: number;
};

//fileList()は、ファイルパスと（再帰処理用の）ディレクトリ深度を受け取って、ファイルリストの配列と総文字数を返す。
export function getFileList(dirPath: string): FileList {
  function createInstanceFileOrDir(dirPath: string): FileOrDir[] {
    const filesInFolder = getFiles(dirPath);
    const files: FileOrDir[] = [];

    for (const dirent of filesInFolder) {
      console.log(dirent.name);
      console.log(dirent.name);
      if (dirent.isDirectory() && dirent.name == "publish") {
        //console.log("publish folder");
      } else if (dirent.name.match(/^\..*/)) {
        //console.log("invisible docs");
      } else if (dirent.isDirectory()) {
        const subDirPath = path.join(dirPath, dirent.name);

        files.push(new Dir(
          dirPath,
          dirent.name,
          createInstanceFileOrDir(subDirPath),
        ));
      } else if (
        dirent.isFile() &&
        [getConfig().draftFileType].includes(path.extname(dirent.name))
      ) {
        //文字数カウントテスト
        let readingFile = fs.readFileSync(
          path.join(dirPath, dirent.name),
          "utf-8"
        );
        //カウントしない文字を除外 from https://github.com/8amjp/vsce-charactercount by MIT license
        readingFile = readingFile
          .replace(/\s/g, "") // すべての空白文字
          .replace(/《(.+?)》/g, "") // ルビ範囲指定記号とその中の文字
          .replace(/[|｜]/g, "") // ルビ開始記号
          .replace(/<!--(.+?)-->/, ""); // コメントアウト

        files.push(new File(
          dirPath,
          dirent.name,
          readingFile.length,
        ));
      }
    }

    return files;
  }

  function flattenFiles(fileOrDir: FileOrDir[]): File[] {
    const files: File[] = [];
    for (const f of fileOrDir) {
      if (f instanceof File) {
        files.push(f);
      }
      if (f instanceof Dir) {
        const subDirFiles = flattenFiles(f.files);
        files.splice(files.length, 0, ...subDirFiles);
      }
    }
    return files;
  }

  const fileOrDir = createInstanceFileOrDir(dirPath);

  //ファイルリストの配列と総文字数を返す
  return {
    label: path.basename(dirPath),
    files: fileOrDir,
    flattenFiles: flattenFiles(fileOrDir),
    length: fileOrDir.reduce((prev, current) => prev + current.charCount, 0),
  };
}

function getFiles(dirPath: string) {
  //console.log("getFiles",dirPath);
  const filesInFolder = fs.existsSync(dirPath)
    ? fs.readdirSync(dirPath, { withFileTypes: true })
    : [];
  if (!filesInFolder) console.log(`${dirPath}が見つかりませんでした`);
  return filesInFolder;
}


type FileNode = {
  id: string;
  dir: string;
  name: string;
  length: number;
  children?: FileNode[];
};

let globalCounter = 0;

export function resetCounter() {
  globalCounter = 0;
}

resetCounter();
export function draftsObject(dirPath: string): FileNode[] {
  const results: FileNode[] = [];

  const filesInFolder = getFiles(dirPath);

  for (const dirent of filesInFolder) {
    if (dirent.isDirectory() && dirent.name == "publish") {
      // console.log("publish folder");
    } else if (dirent.name.match(/^\..*/)) {
      //console.log('invisible docs');
    } else if (dirent.isDirectory() && dirent.name == "dict") {
      // console.log("dictionary folder");
    } else if (dirent.isDirectory()) {
      const directoryPath = path.join(dirPath, dirent.name);
      const containerFiles = draftsObject(directoryPath);

      let containerLength = 0;
      containerFiles.forEach((element) => {
        containerLength += element.length;
      });

      const directory: FileNode = {
        id: `node_${globalCounter++}`,
        dir: path.join(dirPath, dirent.name),
        name: dirent.name,
        length: containerLength,
        children: containerFiles,
      };

      results.push(directory);
    } else if (
      dirent.isFile() &&
      [getConfig().draftFileType].includes(path.extname(dirent.name))
    ) {
      //文字数カウントテスト
      let readingFile = fs.readFileSync(
        path.join(dirPath, dirent.name),
        "utf-8"
      );
      //カウントしない文字を除外 from https://github.com/8amjp/vsce-charactercount by MIT license
      readingFile = readingFile
        .replace(/\s/g, "") // すべての空白文字
        .replace(/《(.+?)》/g, "") // ルビ範囲指定記号とその中の文字
        .replace(/[|｜]/g, "") // ルビ開始記号
        .replace(/<!--(.+?)-->/, ""); // コメントアウト

      const fileNode: FileNode = {
        id: `node_${globalCounter++}`,
        dir: path.join(dirPath, dirent.name),
        name: dirent.name,
        length: readingFile.length,
      };

      results.push(fileNode);
    }
  }

  return results;
}

export function totalLength(dirPath: string): number {
  let result = 0;
  const drafts = draftsObject(dirPath);
  drafts.forEach((element) => {
    result += element.length;
  });
  return result;
}

export function ifFileInDraft(DocumentPath: string | undefined): boolean {
  if (draftRoot() == "") {
    return false;
  }
  //Treeモデル構築
  const tree = new TreeModel();
  const draftTree = tree.parse({ dir: draftRoot(), name: "root", length: 0 });
  //const activeDocumentPath = window.activeTextEditor?.document.uri.fsPath;
  draftsObject(draftRoot()).forEach((element) => {
    const draftNode = tree.parse(element);
    draftTree.addChild(draftNode);
  });
  const activeDocumentObject = draftTree.first(
    (node) => node.model.dir === DocumentPath
  );
  return activeDocumentObject ? true : false;
}
