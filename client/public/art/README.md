# Custom artwork

The game ships with emoji/colour placeholders. To use real images (your own
or properly licensed art — note the official Hasbro Cluedo artwork is
copyrighted and can't be bundled here), drop PNG files into these folders and
flip `USE_CUSTOM_ART` to `true` in `client/src/pages/Game.jsx`.

Files are matched by a lowercase, hyphenated slug of the name. Any file that's
missing falls back to its emoji, so a partial set is fine.

```
public/art/
  suspects/
    miss-scarlett.png      colonel-mustard.png   mrs-white.png
    reverend-green.png     mrs-peacock.png       professor-plum.png
    dr-orchid.png          monsieur-brunette.png
  weapons/
    candlestick.png  knife.png   lead-pipe.png  revolver.png
    rope.png         wrench.png  poison.png     bow-and-arrow.png
  rooms/
    kitchen.png      ballroom.png       conservatory.png  dining-room.png
    billiard-room.png library.png        lounge.png        hall.png
    study.png        cellar.png         trophy-room.png
```

- **suspects** render as round avatars (square images, ~square crop work best).
- **weapons** and **rooms** render inside cards/tiles (transparent PNGs look best).
