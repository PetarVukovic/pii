# ClearCopy implementation plan

Use the approved local-first design. Newmean detects personal information. PDF.js renders document pages, Tesseract reads visible text locally, and pdf-lib rebuilds the export from marked pixels. The web application uses the fork's TypeScript, esbuild and Cloudflare Workers stack.

- Build a synthetic PDF and verify that a new PDF preserves page dimensions while removing original text, metadata and underlying pixels.
- Build the bilingual landing and local editor. Compare the original and proposed output, review every page, add masks manually, and approve the exact export.
- Expose the approved bundle through stdio and one-time HTTPS MCP. Reject unknown IDs, expired shares, cross-origin writes and oversized bodies. Verify both transports with an MCP client.
- Package the portable skill and plugin manifests. Document local installation, hosted setup and the limitations of raster PDF export.
- Measure HR/EN detection on labeled fixtures and verify output with text extraction and OCR.
