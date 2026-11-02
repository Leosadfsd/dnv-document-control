export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  page: number;
}
export interface LetterCandidate {
  drawingNo: string;
  englishTitle: string;
  cn: string;
  owner: string;
  selected: boolean;
}
export interface LetterResult {
  letterNo: string;
  candidates: LetterCandidate[];
  issues: string[];
}
export const safeFilename = (text: string) =>
  text
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
export function letterFilename(
  letterNo: string,
  candidate: LetterCandidate,
  index: number,
): string {
  return (
    safeFilename(
      `Approval Letter NB ${letterNo || '待确认'}_${index + 1}_${candidate.drawingNo}_${candidate.cn || '待补图名'}_${candidate.owner || '待补负责人'}`,
    ) + '.pdf'
  );
}
export function parseLetterItems(items: PdfTextItem[]): LetterResult {
  const full = items.map((i) => i.text).join(' ');
  const letterNo = /D\d+\s*-\s*J\s*-\s*(\d+)/i.exec(full)?.[1] ?? '';
  const candidates: LetterCandidate[] = [];
  const seen = new Set<string>();
  for (const page of [...new Set(items.map((i) => i.page))]) {
    const groups = new Map<number, PdfTextItem[]>();
    for (const item of items.filter((i) => i.page === page)) {
      const y = Math.round(item.y / 3) * 3;
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y)!.push(item);
    }
    const lines = [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, line]) => line.sort((a, b) => a.x - b.x));
    let inTable = false,
      docX = 0,
      titleX = 0,
      statusX = Infinity;
    for (const line of lines) {
      const lineText = line.map((i) => i.text).join(' ');
      const normalized = lineText.replace(/\s/g, '');
      if (
        normalized.includes('DocumentNo') &&
        normalized.includes('Title') &&
        normalized.includes('Status')
      ) {
        inTable = true;
        docX = line.find((i) => /Document/.test(i.text))?.x ?? line[0]?.x ?? 0;
        titleX = line.find((i) => /Title/.test(i.text))?.x ?? docX + 150;
        statusX = line.find((i) => /Code|Status/.test(i.text))?.x ?? Infinity;
        continue;
      }
      if (!inTable) continue;
      if (/Document\s+No\.|Sincerely|\*\*\)|has (?:the following|been)|comment:/i.test(lineText)) {
        inTable = false;
        continue;
      }
      const firstCell = line
        .filter((i) => i.x < titleX && i.x <= docX + 95)
        .map((i) => i.text)
        .join(' ')
        .trim();
      const no = /^([A-Za-z]\d{6,10}(?:-[A-Za-z0-9]+)?)(?:\s|$)/
        .exec(firstCell)?.[1]
        ?.toUpperCase();
      if (no && !seen.has(no)) {
        seen.add(no);
        candidates.push({
          drawingNo: no,
          englishTitle: line
            .filter((i) => i.x >= titleX - 2 && i.x < statusX - 2)
            .map((i) => i.text)
            .join(' '),
          cn: '',
          owner: '',
          selected: true,
        });
      }
    }
  }
  const issues = [];
  if (!letterNo) issues.push('未识别Letter编号，请补充');
  if (!candidates.length)
    issues.push('未识别批复表。扫描件或特殊版式请人工补充图号，不进行OCR猜测。');
  return { letterNo, candidates, issues };
}
