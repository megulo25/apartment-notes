# Apartment Notes

A personal journal for apartments you've toured. For each place you can record:

- A listing link (Zillow, Apartments.com, or any page with photos), plus optional direct image URLs
- Rent, beds/baths, sq ft, visit date
- A 1–5 star rating and a status (Interested / Maybe / Applied / Pass)
- A yes/no/unsure check against your own requirements list (edit it in **Settings**)
- What you liked and disliked, and free-form notes
- Your own photos (optional; resized in the browser before saving)

Pasting a Zillow link fills in the name and city automatically.

## Where data is stored

Everything is saved in your browser (IndexedDB). Nothing is uploaded to a server,
so each device or browser keeps its own copy. Use **Settings → Export backup**
to save a `.json` file, and **Import backup** to load it on another device.

## Running locally

It's a static site with no build step:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
