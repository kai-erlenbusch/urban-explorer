import pandas as pd
import requests
import os

# --- CONFIGURATION ---
# 1. Get your free key here: https://api.census.gov/data/key_signup.html
API_KEY = "87652936fa56e45af8b1926027381b6d600d298f" 

# 2. Define the Variables we need (from 2020 Census PL 94-171)
# P2_001N: Total Population
# P2_002N: Hispanic or Latino
# P2_005N: White alone, not Hispanic
# P2_006N: Black or African American alone, not Hispanic
# P2_008N: Asian alone, not Hispanic
VARIABLES = "P2_001N,P2_002N,P2_005N,P2_006N,P2_008N"

# 3. Define the Geography (All Blocks in NYC)
# State: 36 (New York)
# Counties: 005 (Bronx), 047 (Kings/Brooklyn), 061 (New York/Manhattan), 081 (Queens), 085 (Richmond/Staten Island)
NYC_COUNTIES = "005,047,061,081,085"

def fetch_county_data(county_code):
    url = f"https://api.census.gov/data/2020/dec/pl?get={VARIABLES}&for=block:*&in=state:36&in=county:{county_code}&key={API_KEY}"
    print(f"Fetching data for county {county_code}...")
    
    response = requests.get(url)
    if response.status_code != 200:
        print(f"Error: {response.text}")
        return None
        
    # Convert JSON response to Pandas DataFrame
    data = response.json()
    headers = data[0]
    rows = data[1:]
    return pd.DataFrame(rows, columns=headers)

# --- EXECUTION ---
all_data = []

for county in NYC_COUNTIES.split(','):
    df = fetch_county_data(county)
    if df is not None:
        all_data.append(df)

# Combine all counties
final_df = pd.concat(all_data)

# Rename columns for clarity
final_df = final_df.rename(columns={
    "P2_001N": "TotalPop",
    "P2_002N": "Hispanic",
    "P2_005N": "White",
    "P2_006N": "Black",
    "P2_008N": "Asian",
    "state": "STATE",
    "county": "COUNTY",
    "tract": "TRACT",
    "block": "BLOCK"
})

# Create the GEOID (15-digit ID) to match the Shapefile
# Formula: State (2) + County (3) + Tract (6) + Block (4)
final_df["GEOID"] = final_df["STATE"] + final_df["COUNTY"] + final_df["TRACT"] + final_df["BLOCK"]

# Save to CSV
output_path = "nyc_demographics_2020.csv"
final_df.to_csv(output_path, index=False)

print(f"SUCCESS: Downloaded demographic data for {len(final_df)} blocks.")
print(f"Saved to {output_path}")
print("Preview of data:")
print(final_df.head())