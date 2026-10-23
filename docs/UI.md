# UI components

Datoko uses Tailwind CSS v4 and shadcn/ui's Radix-based new-york components.

- Add components with `npx shadcn@latest add <component>`. Configuration lives in `components.json`.
- Reusable primitives live in `src/components/ui/`. The compatibility exports in `src/components/ui.tsx` add Datoko's status labels and financial metric presentation.
- `DashboardShell` owns navigation, the responsive sheet, and the account footer. Its sidebar preference is saved in a cookie. Ctrl/Cmd+B toggles the desktop sidebar.
- `globals.css` defines the light/dark semantic tokens and the layouts for reporting views. Keep all new colors tied to these tokens.
- Theme choices default to System. A small head script applies the saved preference before paint and keeps shadcn's dark class in sync with OS changes.
- Date and interval controls retain URL state. Reuse `ReportLink` for links that must preserve the reporting period.
- Order sorting and pagination are view-only operations; they do not change financial totals or the selected period.

Validation: `npm run check`, `npm run build`, and `npm run test:e2e`. Browser tests cover desktop/mobile navigation, reporting periods, theme persistence, chart data, sorting, pagination, and read-only demo behavior.
