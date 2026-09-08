export interface UploadItem {
  name: string;
  size: number;
  source: { kind: 'local'; path: string } | { kind: 'file'; file: File };
  thumbnail?: string;
  textPreview?: string;
}

export interface NativeClipboardUpload {
  name: string;
  size: number;
  localPath: string | null;
  dataBase64: string | null;
  thumbnail: string | null;
  textPreview: string | null;
}
