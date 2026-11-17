# Apartment Notes

A personal journal for apartments you've toured. For each place you can record:

- A listing link (Zillow, Apartments.com, or any page with photos), plus optional direct image URLs
- Rent, beds/baths, sq ft, visit date
- A 1–5 star rating and a status (Interested / Maybe / Applied / Pass)
- A yes/no/unsure check against your own requirements list (edit it in **Settings**)
- What you liked and disliked, and free-form notes
- Your own photos (optional; resized in the browser before saving)

Pasting a Zillow link fills in the name and city automatically.

## Voice auto-fill

Tap **Record** on a visit (or **Import audio** for a voice memo) and just talk through the place.

1. The audio is transcribed **on your device** with Whisper (via transformers.js). The ~80 MB speech
   model downloads the first time and is cached after that. Nothing is uploaded for this step.
2. If you've added an Anthropic API key in **Settings**, Claude reads the transcript and fills in
   the form: rent, beds/baths, rating, status, requirements, likes, dislikes, and notes. Filled
   fields are highlighted so you can review before saving.

Without an API key you still get the transcript and can add it to your notes in one tap.
Recordings and transcripts are saved with the visit.

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
