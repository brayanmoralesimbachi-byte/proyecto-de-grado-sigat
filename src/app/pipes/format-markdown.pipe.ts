import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'formatMarkdown',
  standalone: true
})
export class FormatMarkdownPipe implements PipeTransform {

  constructor(private sanitizer: DomSanitizer) {}

  private sanitizeHtml(html: string): string {
    // Eliminar etiquetas peligrosas y su contenido
    const dangerousTags = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'form', 'input'];
    for (const tag of dangerousTags) {
      const regex = new RegExp(`<${tag}[\\s\\S]*?<\/${tag}>|<${tag}[\\s>][^>]*\/?>`, 'gi');
      html = html.replace(regex, '');
    }

    // Eliminar atributos de eventos (onclick, onload, onerror, etc.)
    html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    // Eliminar javascript: URLs
    html = html.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, 'href="#"');

    return html;
  }

  transform(text: string): SafeHtml {
    if (!text) return '';

    // Escapar HTML peligroso primero
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_ (only single *, not **)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

    // Code: `code`
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // Horizontal rule: --- or ***
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\*\*\*$/gm, '<hr>');

    // Lists: - item or * item
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
    
    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*<\/li>[\n]*)+/g, (match) => {
      return '<ul>' + match.replace(/\n/g, '') + '</ul>';
    });

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    // Clean up multiple <br> after <ul>
    html = html.replace(/<\/ul><br>/g, '</ul>');
    html = html.replace(/<ul><br>/g, '<ul>');

    // Sanitizar cualquier HTML residual peligroso
    html = this.sanitizeHtml(html);

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
