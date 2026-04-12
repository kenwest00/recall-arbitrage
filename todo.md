# RecallArb — Todo

## Database Schema
- [x] recalls table (id, recallNumber, agency, title, productName, description, hazard, remedy, refundValue, refundExtracted, recallDate, url, rawNotice, category, manufacturer, createdAt, updatedAt)
- [x] pricingData table (id, recallId, platform, listingTitle, price, condition, listingUrl, quantity, fetchedAt)
- [x] msrpData table (id, recallId, source, msrpPrice, productUrl, fetchedAt)
- [x] profitAnalysis table (id, recallId, avgUsedPrice, ebayAvg, amazonAvg, fbAvg, ebayCount, amazonCount, fbCount, totalCount, refundValue, msrp, profitMargin, profitAmount, meetsThreshold, calculatedAt)
- [x] userSettings table (id, userId, refreshIntervalHours, profitThreshold, preferredAgencies, createdAt, updatedAt)
- [x] reports table (id, userId, name, filters, status, fileUrl, createdAt)
- [x] syncLog table (id, agency, status, recordsIngested, errorMessage, startedAt, completedAt)

## Backend: Recall Ingestion
- [x] CPSC API client (fetch from saferproducts.gov REST API, parse JSON)
- [x] NHTSA API client (fetch from api.nhtsa.gov, paginate all recalls)
- [x] Refund value extractor (regex + LLM-assisted parsing of remedy/description text)
- [x] Recall upsert logic (insert new, update changed, skip unchanged)
- [x] Scheduled refresh job (APScheduler-style, configurable interval, per-user or global)
- [x] Sync log recording (track each ingestion run with status and count)

## Backend: Market Pricing
- [x] eBay sold listings fetcher (eBay Finding API or scrape completed listings)
- [x] Amazon used listings fetcher (scrape or use RapidAPI)
- [x] Facebook Marketplace fetcher (scrape with Playwright)
- [x] MSRP lookup service (Google Shopping scrape or SerpAPI)
- [x] Blended average calculator (average across all platforms with available data)
- [x] Quantity tracker (count available listings per platform)

## Backend: Profit Engine & Reports
- [x] Profit margin calculator (refundValue - avgUsedPrice) / refundValue * 100
- [x] Threshold flagging (compare margin to user's profitThreshold setting)
- [x] CSV report generator (filter by agency, date, threshold, category)
- [x] PDF report generator (styled report with summary table)
- [x] User settings CRUD (get/update refresh interval, threshold, agencies)

## Backend: tRPC Routers
- [x] recalls router (list, getById, search, filter)
- [x] pricing router (getByRecallId, triggerFetch)
- [x] analysis router (getByRecallId, getOpportunities)
- [x] settings router (get, update)
- [x] reports router (list, create, download)
- [x] sync router (getStatus, triggerSync, getLogs)

## Frontend: Dashboard
- [x] DashboardLayout with sidebar navigation
- [x] Recall list table with sortable columns (product, agency, refund, margin, date)
- [x] Profit opportunity highlighting (green/amber/red based on margin vs threshold)
- [x] Filter bar (agency, date range, category, threshold met)
- [x] Summary stats cards (total recalls, opportunities found, avg margin, last sync)
- [x] Sync status indicator and manual trigger button

## Frontend: Recall Detail Page
- [x] Full recall notice text display
- [x] Refund value callout (extracted from notice)
- [x] Platform-by-platform pricing breakdown (eBay, Amazon, Facebook)
- [x] Blended average and profit analysis panel
- [x] MSRP panel (separate from refund value)
- [x] Quantity availability per platform
- [x] Direct links to used listings
- [x] Profit margin badge with threshold indicator

## Frontend: Settings Panel
- [x] Refresh interval selector (1h, 6h, 12h, 24h, custom)
- [x] Profit threshold slider/input (default 10%)
- [x] Agency preference toggles (CPSC, NHTSA)
- [x] Save settings (persisted to user account)

## Frontend: Report Generator
- [x] Filter form (agency, date range, threshold, category)
- [x] Preview table of matching results
- [x] Export CSV button
- [x] Export PDF button
- [x] Report history list with download links

## Auth & User Settings
- [x] Login/logout flow using Manus OAuth
- [x] User settings auto-loaded on login
- [x] Default settings created on first login

## Testing
- [x] Vitest: recall ingestion unit tests
- [x] Vitest: profit calculator unit tests
- [x] Vitest: settings router tests
- [x] Vitest: report generation tests

## Auto Parts Pricing (NHTSA Recalls)
- [x] Update pricing_data platform enum to include: rockauto, carpart, lkq, ebaymotors
- [x] RockAuto price fetcher (search by part keyword, extract price + part number)
- [x] Car-Part.com price fetcher (search used/salvage parts by keyword)
- [x] LKQ/Pick-n-Pull price fetcher (search used OEM parts)
- [x] eBay Motors price fetcher (completed listings for auto parts)
- [x] Smart platform routing: NHTSA recalls → auto parts sources; CPSC recalls → general market sources
- [x] UI: show auto parts platform breakdown separately from general market platforms
- [x] UI: label platforms clearly (eBay Motors vs eBay general, etc.)

## eBay API Integration (Official Credentials)
- [x] eBay credentials set (EBAY_APP_ID, EBAY_CERT_ID, EBAY_DEV_ID)
- [x] Validate credentials via eBay OAuth2 client credentials token endpoint
- [x] Build eBay API client: OAuth2 token fetch + auto-refresh
- [x] Finding API: findCompletedItems (sold listings) for general eBay (CPSC)
- [x] Finding API: findCompletedItems with categoryId=6030 for eBay Motors (NHTSA)
- [x] Browse API: search for current active listings (quantity available)
- [x] Replace HTML scraping in marketPricing.ts with official API calls
- [x] Replace HTML scraping in autoPartsPricing.ts with official API calls
- [x] Update vitest to validate eBay API client with credential check
