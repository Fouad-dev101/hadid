package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

// writeICO draws a weight plate (the Hadid mark) and wraps it as a PNG-in-ICO file.
// install.bat calls `hadid.exe --make-ico <path>` so no image tools are needed.
func writeICO(path string) error {
	const n = 256
	img := image.NewNRGBA(image.Rect(0, 0, n, n))
	c := float64(n-1) / 2
	orange := color.NRGBA{255, 77, 26, 255}
	deep := color.NRGBA{196, 48, 8, 255}
	ink := color.NRGBA{14, 15, 14, 255}
	chalk := color.NRGBA{236, 234, 227, 255}
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			dx, dy := float64(x)-c, float64(y)-c
			d := math.Hypot(dx, dy)
			var px color.NRGBA
			switch {
			case d > 122:
				px = color.NRGBA{} // transparent corners
			case d > 114:
				px = ink
			case d > 104:
				px = orange
			case d > 98:
				px = deep
			case d > 66:
				px = orange
			case d > 60:
				px = ink
			case d > 30:
				px = orange
			case d > 24:
				px = deep
			default:
				px = ink
			}
			// a chalk "stamp" bar through the middle ring, like a barbell sleeve
			if d > 30 && d <= 60 && math.Abs(dy) < 5 {
				px = chalk
			}
			img.SetNRGBA(x, y, px)
		}
	}
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		return err
	}
	var out bytes.Buffer
	hdr := []any{uint16(0), uint16(1), uint16(1)} // reserved, type=icon, count=1
	for _, v := range hdr {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	entry := []any{uint8(0), uint8(0), uint8(0), uint8(0), uint16(1), uint16(32), uint32(pngBuf.Len()), uint32(22)}
	for _, v := range entry {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	out.Write(pngBuf.Bytes())
	return os.WriteFile(path, out.Bytes(), 0o644)
}
