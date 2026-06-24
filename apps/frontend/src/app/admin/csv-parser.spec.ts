import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv-parser';

describe('parseCsv', () => {
  it('parses comma-separated files with trimmed headers and values', () => {
    expect(parseCsv('\uFEFFnome, matricula\n Maria , 123 \n João,456')).toEqual({
      headers: ['nome', 'matricula'],
      rows: [
        { nome: 'Maria', matricula: '123' },
        { nome: 'João', matricula: '456' },
      ],
    });
  });

  it('detects semicolon and tab delimiters from the first line', () => {
    expect(parseCsv('nome;matricula\nAna;789').rows[0]).toEqual({ nome: 'Ana', matricula: '789' });
    expect(parseCsv('nome\tmatricula\nCaio\t101').rows[0]).toEqual({ nome: 'Caio', matricula: '101' });
  });

  it('keeps quoted delimiters, escaped quotes, and line breaks inside a field', () => {
    expect(parseCsv('nome,obs\n"Ana, Souza","Linha 1\nLinha ""2"""')).toEqual({
      headers: ['nome', 'obs'],
      rows: [{ nome: 'Ana, Souza', obs: 'Linha 1\nLinha "2"' }],
    });
  });

  it('ignores blank records and pads missing cells with empty strings', () => {
    expect(parseCsv('nome,matricula\n\nAna\n')).toEqual({
      headers: ['nome', 'matricula'],
      rows: [{ nome: 'Ana', matricula: '' }],
    });
  });

  it('handles Windows line endings', () => {
    expect(parseCsv('nome,matricula\r\nAna,123\r\n').rows).toEqual([{ nome: 'Ana', matricula: '123' }]);
  });

  it('throws localized errors for malformed or headerless CSV content', () => {
    expect(() => parseCsv('"sem fechamento')).toThrow('O CSV possui uma coluna com aspas sem fechamento.');
    expect(() => parseCsv('')).toThrow('O CSV precisa incluir uma linha de cabeçalho.');
  });
});
