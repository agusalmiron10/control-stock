// xlsx-js-style no trae tipos propios: declaramos lo que usamos.
declare module "xlsx-js-style" {
  export interface CellObject {
    t: "s" | "n" | "d" | "b";
    v: string | number | Date | boolean;
    z?: string;
    s?: any;
  }
  export type WorkSheet = Record<string, any>;
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  export const utils: {
    encode_cell(addr: { r: number; c: number }): string;
    encode_range(range: { s: { r: number; c: number }; e: { r: number; c: number } }): string;
    book_new(): WorkBook;
    book_append_sheet(wb: WorkBook, ws: WorkSheet, name: string): void;
  };
  export function writeFile(wb: WorkBook, filename: string): void;
}
