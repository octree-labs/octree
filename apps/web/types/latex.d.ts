declare module 'latex.js' {
  export class HtmlGenerator {
    constructor(options?: { customHeaders?: string[] });
    parse(content: string): string;
  }
}
