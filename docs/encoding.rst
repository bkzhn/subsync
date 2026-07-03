Character encoding
==================

Subtitle files in the wild are a character-encoding minefield. A Russian ``.srt``
is very likely Windows-1251; a Chinese one might be GBK or Big5; older files show
up as Latin-1, Shift-JIS, or UTF-16 with a byte-order mark. Get the encoding
wrong and you don't get an error — you get mojibake, or a subtitle that fails to
parse. Robust handling of these legacy encodings is one of the things ffsubsync
does notably well compared to other subtitle sync tools, and it happens
automatically by default.

Automatic detection (``infer``)
-------------------------------

The input encoding option, ``--encoding``, defaults to the sentinel value
``infer``. In this mode ffsubsync reads the subtitle file as **raw bytes** and
asks a character-encoding detection library to guess the encoding, then decodes
with the winning guess.

To be resilient, ffsubsync consults up to three detectors in a fixed preference
order and takes the **first** one that returns a result:

1. **cchardet** — a fast C-based detector (see the availability note below),
2. **charset_normalizer** — a pure-Python detector, always installed,
3. **chardet** — the classic pure-Python detector.

Whichever library is installed and answers first wins; if a detector is missing
or raises, ffsubsync simply moves on to the next. The detected encoding is logged
so you can see what it chose.

Detection then degrades gracefully. When ffsubsync decodes the bytes it uses
Python's ``errors="replace"`` mode, so an imperfect guess produces a few
replacement characters rather than crashing the whole sync.

Byte-order marks (BOMs)
-----------------------

There is no special-case BOM-stripping code, and none is needed. Because the file
is handed to the detector as raw bytes, a UTF-8/UTF-16/UTF-32 BOM is part of what
the detector inspects, so it reports the appropriate codec (``UTF-8-SIG``,
``UTF-16``, and so on). Python's decoder for those codecs then consumes the BOM
during decoding. UTF-16 in particular is explicitly handled this way.

Forcing an encoding
-------------------

If you already know the encoding — or the detector guesses wrong on an ambiguous
file — pass it explicitly to skip detection entirely:

.. code-block:: console

   $ ffs video.mp4 -i input.srt -o output.srt --encoding windows-1251

Any codec name Python understands is accepted (``latin-1``, ``cp1251``,
``shift_jis``, ``big5``, ``utf-16``, ...).

Output encoding
---------------

Output is controlled separately by ``--output-encoding``, which defaults to
``utf-8``. Modern players prefer UTF-8, so converting legacy-encoded input to
UTF-8 on the way out is usually what you want and happens by default. To instead
preserve the input's encoding, pass the special value ``same``:

.. code-block:: console

   $ ffs video.mp4 -i input.srt -o output.srt --output-encoding same

.. note::

   ffsubsync defaults to UTF-8 output regardless of the input encoding. This is a
   deliberate change from very early versions, which reused the input encoding by
   default; ``--output-encoding same`` restores that older behavior when you need
   it.

Reference encoding
------------------

When the reference is itself a subtitle file (see :doc:`reference_types`), its
encoding is auto-detected the same way as the input. Override it with
``--reference-encoding`` if needed. This option only applies to subtitle
references — passing it alongside a video reference is an error.

.. _cchardet-availability:

The cchardet availability caveat
--------------------------------

The fastest and often most accurate detector in the chain, **cchardet**,
deserves a closer look, because whether it is present depends on your Python
version.

The original ``cchardet`` package is unmaintained. ffsubsync switched to the
maintained fork, `faust-cchardet
<https://pypi.org/project/faust-cchardet/>`_, in v0.4.25. The important quirk is
that faust-cchardet still installs under the **module name** ``cchardet`` — which
is why the code simply does ``import cchardet`` even though the declared
dependency is ``faust-cchardet``.

faust-cchardet is declared as a dependency only for **Python < 3.13**:

.. code-block:: text

   chardet;python_version>='3.7'
   charset_normalizer
   faust-cchardet;python_version<'3.13'

The practical consequences:

- **On Python < 3.13**, the full chain is available. cchardet is tried first, so
  you get the fast C detector.
- **On Python 3.13+**, faust-cchardet is not installed. The ``import cchardet``
  fails quietly, and detection falls through to ``charset_normalizer`` (always
  present) and then ``chardet``. Everything still works — you just lose the C
  detector and rely on the pure-Python ones.

For the vast majority of files this makes no observable difference; the
pure-Python detectors handle common encodings well. The edge cases are ambiguous
legacy encodings where the detectors can disagree. If you are on Python 3.13+ and
hit a file that detects wrong, you have two clean options:

1. Pass the correct encoding explicitly with ``--encoding`` (see above), or
2. Run ffsubsync under an older Python (3.12 or earlier) where faust-cchardet is
   available.

.. tip::

   You can check which detectors are active in your environment with:

   .. code-block:: console

      $ python -c "import cchardet" && echo "cchardet available" || echo "cchardet NOT available"
      $ python -c "import charset_normalizer, chardet; print('pure-python detectors present')"
