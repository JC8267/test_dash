import streamlit as st
import pandas as pd
import duckdb
import matplotlib.pyplot as plt
from datetime import date

# Streamlit configuration
st.set_page_config(layout="wide")

# Connect to DuckDB
con = duckdb.connect()

# 1) Get available months
months_df = con.execute(
    """
    SELECT DISTINCT date_trunc('month', CAST(batch_date AS DATE)) AS month
    FROM parquet_scan('C:/data/price_history_enriched.parquet')
    ORDER BY month
    """
).df()
months = months_df['month'].dt.date.tolist()

# 2) Sidebar for start and end month
st.sidebar.header("Configuration")
start_month = st.sidebar.selectbox(
    "Start month (defines SKU set)",
    options=months,
    index=months.index(date(2024, 9, 1))
)
end_month = st.sidebar.selectbox(
    "End month (display through)",
    options=months,
    index=len(months) - 1
)
if start_month > end_month:
    st.sidebar.error("Start must be on or before End")
    st.stop()

# 3) Build ref_skus table
con.execute(
    """
    CREATE OR REPLACE TEMP TABLE ref_skus AS
    SELECT DISTINCT listing_id, source_product_area, platform_id
    FROM parquet_scan('C:/data/price_history_enriched.parquet')
    WHERE date_trunc('month', CAST(batch_date AS DATE)) = ?
    """,
    [pd.to_datetime(start_month)]
)

# 4) Filters: product areas and platforms
# Load areas present in the reference SKU set
areas = con.execute(
    "SELECT DISTINCT source_product_area FROM ref_skus ORDER BY source_product_area"
).df()['source_product_area'].tolist()

st.sidebar.write(f"Debug: Found {len(areas)} areas")

# Simple multiselect without complex state management
sel_areas = st.sidebar.multiselect(
    "Product areas", 
    options=areas,
    help="Select one or more product areas to analyze"
)

st.sidebar.write(f"Debug: Selected {len(sel_areas)} areas: {sel_areas}")

# Initialize sel_plats to empty list
sel_plats = []

# Early exit if no areas selected - but don't use st.stop() yet
if not sel_areas:
    st.info("👆 Please select at least one product area from the sidebar to view data.")
    # Don't create platform selector if no areas selected
    st.sidebar.write("Platforms: (select product areas first)")
else:
    # Load platforms only after areas are selected
    try:
        df_plats = con.execute(
            "SELECT DISTINCT platform_id FROM ref_skus WHERE source_product_area = ANY(?) ORDER BY platform_id",
            [sel_areas]
        ).df()
        platforms = df_plats['platform_id'].tolist()
        
        st.sidebar.write(f"Debug: Found {len(platforms)} platforms for selected areas")
        
        sel_plats = st.sidebar.multiselect(
            "Platforms", 
            options=platforms,
            default=platforms,  # Default to all platforms for selected areas
            help="Select platforms to include in analysis"
        )
        
        st.sidebar.write(f"Debug: Selected {len(sel_plats)} platforms: {sel_plats}")
        
        # Now check if we have valid selections for the rest of the analysis
        if not sel_plats:
            st.info("👆 Please select at least one platform from the sidebar to view data.")
        else:
            # Continue with the rest of your analysis here
            st.success(f"Ready to analyze {len(sel_areas)} areas across {len(sel_plats)} platforms!")
            
            # Your existing query code goes here...
            # df_grouped = con.execute(...)
            
    except Exception as e:
        st.error(f"Error loading platforms: {str(e)}")
        st.sidebar.write("Platforms: (error loading)")

# Remove the st.stop() calls that were causing issues
# 5) Query avg_price by month with correct parameter placeholders
df_grouped = con.execute(
    """
    SELECT
        source_product_area,
        platform_id,
        date_trunc('month', CAST(batch_date AS DATE)) AS month,
        AVG(listing_price) AS avg_price
    FROM parquet_scan('C:/data/price_history_enriched.parquet')
    WHERE date_trunc('month', CAST(batch_date AS DATE)) BETWEEN ? AND ?
      AND listing_id IN (SELECT listing_id FROM ref_skus)
      AND source_product_area = ANY(?)
      AND platform_id        = ANY(?)
    GROUP BY 1,2,3
    ORDER BY 1,2,3
    """,
    [
        pd.to_datetime(start_month),
        pd.to_datetime(end_month),
        sel_areas,
        sel_plats
    ]
).df()

# 6) Compute percent change
pivot = df_grouped.pivot_table(
    index=['source_product_area','platform_id'],
    columns='month', values='avg_price'
)
pivot['pct_change'] = (
    (pivot[pd.to_datetime(end_month)] - pivot[pd.to_datetime(start_month)])
    / pivot[pd.to_datetime(start_month)] * 100
)
pivot = pivot.reset_index()

# Melt for plotting
plot_df = pivot.melt(
    id_vars=['source_product_area','platform_id','pct_change'],
    value_vars=[c for c in pivot.columns if isinstance(c, pd.Timestamp)],
    var_name='month', value_name='avg_price'
)
plot_df['month'] = pd.to_datetime(plot_df['month'])

# Filter to selected areas & platforms
filtered = plot_df[
    plot_df['source_product_area'].isin(sel_areas) &
    plot_df['platform_id'].isin(sel_plats)
]

# 7) Render chart
st.title(f"Avg Price Trend )({start_month} → {end_month})")
fig, ax = plt.subplots(figsize=(12, 6))
for platform, grp in filtered.groupby('platform_id', observed=True):
    pct = grp['pct_change'].iloc[0]
    ax.plot(
        grp['month'], grp['avg_price'],
        marker='o',
        label=f"{platform} ({pct:+.1f}%)"
    )
ax.set_xlabel('Month')
ax.set_ylabel('Avg Price')
ax.legend(loc='upper left', bbox_to_anchor=(1, 1), fontsize='small')
plt.subplots_adjust(right=0.75)
st.pyplot(fig)

# Optional data table
if st.checkbox("Show underlying data table"):
    st.dataframe(filtered.reset_index(drop=True), use_container_width=True)
