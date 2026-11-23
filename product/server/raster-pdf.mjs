import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFRawStream, PDFString, PDFHexString } from 'pdf-lib';

const name = PDFName.of;
const allowed = (dictionary, fields) => dictionary.keys().every((key) => fields.includes(key.decodeText()));

export async function assertRasterPdf(encoded) {
  if (!encoded) return;
  const pdf = await PDFDocument.load(encoded, { updateMetadata: false, throwOnInvalidObject: true });
  const pageCount = pdf.getPageCount();
  if (pageCount < 1 || pageCount > 20 || !allowed(pdf.catalog, ['Type', 'Pages', 'Info'])) throw new Error('Unexpected PDF structure');
  const context = pdf.context;
  for (const entry of [context.trailerInfo.Info, pdf.catalog.get(name('Info'))]) {
    if (!entry || entry === PDFNull) continue;
    const info = context.lookupMaybe(entry, PDFDict);
    if (!info || !allowed(info, ['Title', 'Producer'])) throw new Error('Unexpected PDF metadata');
    const title = info.lookupMaybe(name('Title'), PDFString, PDFHexString);
    if (title && title.decodeText() !== 'ClearCopy') throw new Error('Unexpected PDF title');
    const producer = info.lookupMaybe(name('Producer'), PDFString, PDFHexString);
    if (producer && !/^MuPDF \d+\.\d+(?:\.\d+)?$/.test(producer.decodeText())) throw new Error('Unexpected PDF producer');
  }
  for (const page of pdf.getPages()) {
    if (!allowed(page.node, ['Type', 'MediaBox', 'Rotate', 'Resources', 'Parent', 'Contents', 'Annots'])) throw new Error('Unexpected PDF page features');
    if (page.node.lookupMaybe(name('Annots'), PDFArray)?.size()) throw new Error('Unexpected PDF annotations');
    const resources = page.node.Resources();
    if (!resources || !allowed(resources, ['XObject', 'Font', 'ExtGState'])) throw new Error('Unexpected PDF page resources');
    for (const type of ['Font', 'ExtGState']) {
      if (resources.lookupMaybe(name(type), PDFDict)?.keys().length) throw new Error('Unexpected PDF drawing resources');
    }
    const images = resources.lookupMaybe(name('XObject'), PDFDict);
    if (!images || images.keys().length !== 1) throw new Error('Each exported page must contain one raster image');
    const image = images.lookupMaybe(images.keys()[0], PDFRawStream);
    if (!image || image.dict.get(name('Subtype')) !== name('Image') || image.dict.has(name('Metadata'))) {
      throw new Error('Unexpected PDF image features');
    }
  }
}
