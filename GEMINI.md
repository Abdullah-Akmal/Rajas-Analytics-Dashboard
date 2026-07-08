# Project Overview: Rajas Analytics Dashboard

The **Rajas Analytics Dashboard** is a comprehensive business intelligence tool designed for restaurant management, specifically for the "Rajas" brand (Hyde Park and Grand Arcade locations). It provides real-time insights into sales, profitability, delivery performance, and customer behavior by aggregating data from multiple third-party sources.

## Core Technologies
- **Framework:** Next.js 16.2.6 (App Router)
- **Frontend:** React 19, Tailwind CSS 4.2.0, Lucide React (Icons), Recharts (Data Visualization)
- **UI Components:** Shadcn UI (Radix UI primitives)
- **Backend:** Next.js Server Actions
- **Database:** PostgreSQL with Drizzle ORM (0.45.2)
- **Authentication:** Better Auth (1.6.18)
- **Data Fetching:** Google Sheets API, Presto API, Shipday API
- **Analytics:** Vercel Analytics

## Project Structure
- `app/`: Next.js App Router directory.
    - `dashboard/`: Main dashboard area with nested modules (sales, costing, delivery, etc.).
    - `actions/`: Server actions for data synchronization and retrieval.
    - `api/auth/`: Better Auth API routes.
- `components/`: Reusable UI components.
    - `ui/`: Shared Shadcn UI components.
- `lib/`: Core library functions.
    - `db/`: Database configuration and schema definitions (`schema.ts`).
    - `auth.ts`: Authentication configuration.
- `public/`: Static assets (icons, logos).

## Data Integrations
The application syncs data via server actions found in `app/actions/dashboard.ts`:
- **Google Sheets:** Syncs menu items, categories, and unit costs.
- **Presto API:** Syncs daily sales data, including orders and individual line items.
- **Shipday API:** Syncs delivery metrics, driver performance, and delivery times.

## Building and Running

### Prerequisites
- Node.js (Latest LTS recommended)
- PostgreSQL database
- Environment variables configured (see `.env` requirements below)

### Commands
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Lint the project
npm run lint
```

### Environment Variables (Required)
The project requires the following environment variables (inferred from `lib/auth.ts` and `app/actions/dashboard.ts`):
- `DATABASE_URL`: PostgreSQL connection string.
- `BETTER_AUTH_SECRET`: Secret key for authentication.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: For Google Sheets sync.
- `GOOGLE_PRIVATE_KEY`: For Google Sheets sync.
- `GOOGLE_SHEET_ID`: Target spreadsheet ID.
- `PRESTO_API_KEY`: For Presto API access.
- `PRESTO_API_SECRET`: For Presto API access.
- `PRESTO_BASE_URL`: Presto API endpoint.
- `SHIPDAY_API_KEY`: For Shipday API access.

## Development Conventions
- **Server Actions:** Use "use server" actions in `app/actions/` for data operations.
- **Database Schema:** Define all tables and relationships in `lib/db/schema.ts`.
- **UI Consistency:** Use Shadcn UI components and Tailwind CSS for styling. Follow the established color scheme (defined in `app/globals.css`).
- **Data Synchronization:** Sync logic is centralized in `app/actions/dashboard.ts`. Always log sync status to the `sync_logs` table.
- **Type Safety:** Maintain strict TypeScript typing, especially for API responses and database queries.
