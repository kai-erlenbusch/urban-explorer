# 🏙️ Urban Explorer: NYC (Based upon Morphocode Explorer [https://explorer.morphocode.com/])

A high-performance geospatial analysis tool that lets users explore New York City's urban fabric in real-time. Built with **Svelte**, **MapLibre GL**, and **Turf.js**, it performs complex spatial operations (demographics, land use, transit accessibility) entirely in the browser using multi-threaded architecture.

## 🚀 Key Features

* **"Ped-Shed" Analysis:** Drag a radius anywhere in NYC to see instant analytics.
* **Three Analytical Modes:**
    * **🏗️ Land Use:** Analyzes MapPLUTO data to calculate entropy scores and land use mix.
    * **👥 Demographics:** Aggregates census data to visualize population density, racial diversity, and age distribution.
    * **🚇 Transit Network:** Identifies accessible Subway, Rail (LIRR/MNR/NJT), and Bus routes with instant intersection checks.
* **High-Performance Architecture:** Capable of querying 100,000+ points and lines at 60fps without freezing the UI.

## 🛠️ Technical Architecture

This project solves the "blocked main thread" problem common in browser-based GIS applications.

### 1. The "Orphaned" UI Thread
Geospatial operations (like `turf.pointsWithinPolygon` or Line Intersections) are CPU-intensive. Running them on the main thread causes the map to stutter.
* **Solution:** All heavy lifting is offloaded to a **Web Worker** (`analysis.worker.js`). The UI thread handles rendering and user input, while the worker handles the math.

### 2. Backpressure Throttling
Mouse movements trigger ~60 events per second, but spatial analysis takes ~50ms.
* **Solution:** A "latest-only" throttling strategy is implemented in `Map.svelte`. If the worker is busy, intermediate requests are dropped, ensuring the user always sees the most current data without a queue buildup ("lag").

### 3. Spatial Optimization
* **Pre-Calculated Bounding Boxes:** To speed up line intersection checks for transit routes, BBoxes are pre-calculated on load, changing an $O(N)$ geometric operation into an instant numeric check.
* **Reactive Stores:** Svelte Stores (`stores.js`) decouple the Map (data producer) from the Sidebar (data consumer), ensuring clean, unidirectional data flow.

## 📦 Tech Stack

* **Frontend:** Svelte, Vite
* **Mapping:** MapLibre GL JS, Vector Tiles (MVT)
* **Analysis:** Turf.js (Spatial Analysis), Web Workers API
* **Styling:** CSS Grid, Custom SVG Charts (Donut/Waffle)

## 📊 Data Sources

* **Land Use:** NYC MapPLUTO (Department of City Planning)
* **Demographics:** US Census Bureau (2020 Decennial Census)
* **Transit:** MTA Static GTFS Data, NJ Transit Open Data