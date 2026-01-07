# 🏙️ Urban Explorer: NYC (Based upon Morphocode Explorer [https://explorer.morphocode.com/])

A high-performance geospatial analysis tool that lets users explore New York City's urban fabric in real-time. Built with **Svelte**, **MapLibre GL**, and **Turf.js**, it performs complex spatial operations (demographics, land use, transit accessibility) entirely in the browser using multi-threaded architecture.

## 🚀 Key Features

* **"Ped-Shed" Analysis:** Drag a radius anywhere in NYC to see instant analytics.
* **Three Analytical Modes:**
    * **🏗️ Land Use:** Analyzes MapPLUTO data to calculate entropy scores and land use mix.
    * **👥 Demographics:** Aggregates census data to visualize population density, racial diversity, and age distribution.
    * **🚇 Transit Network:** Identifies accessible Subway, Rail (LIRR/MNR/NJT), and Bus routes with instant intersection checks.
* **High-Performance Architecture:** Capable of querying 100,000+ points and lines at 60fps without freezing the UI.

## 📦 Tech Stack

* **Frontend:** Svelte, Vite
* **Mapping:** MapLibre GL JS, Vector Tiles (MVT)
* **Analysis:** Turf.js (Spatial Analysis), Web Workers API
* **Styling:** CSS Grid, Custom SVG Charts (Donut/Waffle)

## 📊 Data Sources

* **Land Use:** NYC MapPLUTO (Department of City Planning)
* **Demographics:** US Census Bureau (2020 Decennial Census)
* **Transit:** MTA Static GTFS Data, NJ Transit Open Data
