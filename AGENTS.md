# ClearCopy fork

- Product code, web editor, plugin and MCP live under `product/`. The remaining Newmean SDK code keeps its Apache-2.0 license and notices.
- Keep original files, prompts, detection results and review plans on the user's computer. Local MCP reads only an explicitly imported export. A cloud handoff is opt-in and receives the approved copy.
- Share only synthetic fixtures in git, logs, screenshots and issue reports. Keep default remote sharing disabled. Never copy production credentials or upstream Cloudflare bindings.
- Read `product/README.md` for setup, package and transport details. Run `npm ci`, `npm run build`, `npm test` and `npm run bench` from `product/`. Follow the documented native and browser test commands for changes to export, OCR, or data transfer.
- Use MIT for ClearCopy code. Disclose PyMuPDF, PyMuPDF Layout and PyMuPDF4LLM's AGPL-3.0 or commercial licensing terms when documenting or distributing the optional Python workflow.
