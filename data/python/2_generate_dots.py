import geopandas as gpd
import pandas as pd
import numpy as np
from shapely.geometry import Point
import random
import os
import sys

# --- CONFIGURATION ---
DOT_SCALE = 5 

# Get the directory where THIS script is located
script_dir = os.path.dirname(os.path.abspath(__file__))

# Construct paths relative to the script's location
# UPDATED: Changed folder to 'nycb2020_25d'
SHAPEFILE_PATH = os.path.join(script_dir, "../raw/nycb2020_25d/nycb2020.shp")
CSV_PATH = os.path.join(script_dir, "../raw/nyc_demographics_2020.csv")
OUTPUT_PATH = os.path.join(script_dir, "../census_dots.geojson")

# Debug: Print the paths to verify
print(f"Script location: {script_dir}")
print(f"Looking for Shapefile at: {os.path.abspath(SHAPEFILE_PATH)}")
print(f"Looking for CSV at: {os.path.abspath(CSV_PATH)}")

# Check if files exist before trying to load
if not os.path.exists(SHAPEFILE_PATH):
    print(f"\n❌ ERROR: Shapefile not found at {SHAPEFILE_PATH}")
    print("Please check your 'data/raw' folder. Is the .shp file name inside 'nycb2020_25d' actually 'nycb2020.shp'?")
    sys.exit(1)

if not os.path.exists(CSV_PATH):
    print(f"\n❌ ERROR: CSV not found at {CSV_PATH}")
    sys.exit(1)

# --- 1. LOAD DATA ---
print("Loading Shapefile (this may take a moment)...")
gdf = gpd.read_file(SHAPEFILE_PATH)

# Ensure CRS is projected (EPSG:2263 - LI Feet) for accurate area/containment checks
if gdf.crs and gdf.crs.to_string() != "EPSG:2263":
    print("Reprojecting shapefile to EPSG:2263...")
    gdf = gdf.to_crs(epsg=2263)

print("Loading Demographics CSV...")
df_demo = pd.read_csv(CSV_PATH, dtype={'GEOID': str})

# --- 2. PREPARE THE JOIN ---
if 'GEOID' not in gdf.columns:
    print("WARNING: 'GEOID' column not found in shapefile. Checking for 'GEOID20'...")
    if 'GEOID20' in gdf.columns:
        gdf = gdf.rename(columns={'GEOID20': 'GEOID'})
    else:
        raise ValueError("Could not find GEOID column in shapefile.")

# Join Attributes to Geometry
print("Joining Data...")
merged = gdf.merge(df_demo, on="GEOID", how="inner")
print(f"Matched {len(merged)} census blocks (All NYC).")

# --- FILTER FOR MANHATTAN ONLY ---
# Manhattan is New York County (Code '061')
# Codes: Bronx=005, Kings(BK)=047, New York(Manhattan)=061, Queens=081, Richmond(SI)=085
print("Filtering for Manhattan (County 061)...")
merged = merged[merged['COUNTY'] == 61]  # Note: Pandas might treat it as integer 61 or string "061"

if len(merged) == 0:
    # If integer didn't work, try string
    merged = gdf.merge(df_demo, on="GEOID", how="inner")
    merged = merged[merged['COUNTY'] == "061"]

print(f"Processing {len(merged)} Manhattan blocks.")

# --- 3. GENERATE DOTS ALGORITHM ---
def get_random_points_in_polygon(polygon, num_points):
    points = []
    min_x, min_y, max_x, max_y = polygon.bounds
    
    attempts = 0
    max_attempts = num_points * 20 
    
    while len(points) < num_points and attempts < max_attempts:
        p = Point(random.uniform(min_x, max_x), random.uniform(min_y, max_y))
        if p.within(polygon):
            points.append(p)
        attempts += 1
    return points

# --- 4. EXECUTION ---
print("Generating dots... (Grab a coffee, this happens block by block)")

dot_geoms = []
dot_ethnicities = []

# Iterate over every block
for idx, row in merged.iterrows():
    geom = row.geometry
    
    # Dictionary mapping column name to Ethnicity Label
    groups = {
        'Asian': row['Asian'],
        'Black': row['Black'],
        'Hispanic': row['Hispanic'],
        'White': row['White'],
        'Other': row['TotalPop'] - (row['Asian'] + row['Black'] + row['Hispanic'] + row['White'])
    }
    
    for eth_label, count in groups.items():
        if pd.isna(count) or count <= 0:
            continue
            
        # Integer division: 13 people / 5 scale = 2 dots
        num_dots = int(count // DOT_SCALE)
        
        if num_dots > 0:
            new_points = get_random_points_in_polygon(geom, num_dots)
            
            # Add to our lists
            dot_geoms.extend(new_points)
            dot_ethnicities.extend([eth_label] * len(new_points))

# --- 5. CREATE & SAVE GEOJSON ---
print(f"Creating final GeoDataFrame with {len(dot_geoms)} dots...")
gdf_dots = gpd.GeoDataFrame(
    {'Ethnicity': dot_ethnicities}, 
    geometry=dot_geoms, 
    crs="EPSG:2263"
)

# Convert back to Lat/Lon (EPSG:4326) for Mapbox
print("Converting to Lat/Lon...")
gdf_dots = gdf_dots.to_crs(epsg=4326)

print(f"Saving to {OUTPUT_PATH}...")
gdf_dots.to_file(OUTPUT_PATH, driver="GeoJSON")

print("✅ DONE! You are ready to upload 'census_dots.geojson' to Mapbox Studio.")