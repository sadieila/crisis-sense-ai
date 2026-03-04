# Crisis-Sense AI

Crisis-Sense AI is an academic prototype platform designed to detect emerging crises from citizen reports using artificial intelligence and structured incident analysis.

The system transforms raw reports into actionable insights by linking related signals, identifying incidents, and providing AI-assisted reasoning for decision support.

---

## Overview

Crisis-Sense AI demonstrates how AI and structured data processing can support crisis detection and situational awareness.

The platform allows:

- Citizens to submit reports
- Automatic grouping of reports into incidents
- AI analysis of incidents
- Detection of weak signals that may indicate emerging crises
- Exporting structured reports for institutional review

---

## Key Features

### Citizen Reporting Portal
Citizens can submit reports describing issues in their area such as:

- health issues
- infrastructure problems
- supply shortages
- environmental hazards

These reports form the data foundation for the platform.

---

### Incident Detection

The system groups related reports into incidents based on:

- location
- category
- time proximity

This deterministic logic prevents incorrect automated grouping.

---

### AI Intelligence Layer

Artificial intelligence is used to:

- analyze incidents
- detect causal relationships
- generate structured crisis summaries
- provide reasoning and confidence levels

AI assists analysis but **never automatically creates or modifies incidents**.

---

### Crisis Intelligence Dashboard

The dashboard provides an operational overview including:

- active crises
- incidents under monitoring
- advisory signals
- detailed incident analysis
- linked reports

---

### Evidence Export

Each crisis can be exported as a structured report including:

- incident metadata
- linked reports
- AI reasoning
- evidence summary

This allows institutional review and decision support.

---

## Technology Stack

Frontend:
- React
- TypeScript
- Vite
- TailwindCSS

Backend:
- Node.js
- Express

Database:
- Supabase

AI Layer:
- LLM-powered incident analysis

---

## Architecture

The platform follows a layered architecture:


Citizen Reports → Incident Grouping → AI Analysis → Crisis Dashboard → Institutional Export


1. Citizens submit reports
2. Reports are grouped into incidents
3. AI analyzes incidents
4. Signals and crises are visualized
5. Evidence can be exported for review

---

## Security Design

The system includes several security controls:

- role-based access control
- authenticated dashboard endpoints
- audit logging
- PII filtering in exports
- rate limiting on citizen submissions

---

## Project Status

This project is an **academic prototype** created for research and demonstration purposes.

It is not intended for operational crisis management deployment.

---

## Screenshots

(Add screenshots of the dashboard here)

---

## Author

Sadi  
Computer Science Student

---

## License

Academic / Demonstration Project
