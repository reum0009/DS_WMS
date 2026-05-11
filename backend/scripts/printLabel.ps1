param(
  [Parameter(Mandatory=$true)][string]$DataPath
)

$ErrorActionPreference = 'Stop'
trap {
  Write-Error $_
  exit 1
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$json = Get-Content -LiteralPath $DataPath -Raw -Encoding UTF8
$data = $json | ConvertFrom-Json

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = [string]$data.printerName
if (-not $doc.PrinterSettings.IsValid) {
  throw "Printer not found: $($data.printerName)"
}

$paperWidth = [int]($data.paperWidthHundredths -as [int])
$paperHeight = [int]($data.paperHeightHundredths -as [int])
if ($paperWidth -le 0) { $paperWidth = 197 }
if ($paperHeight -le 0) { $paperHeight = 118 }

$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('WMS Label', $paperHeight, $paperWidth)
$doc.DefaultPageSettings.Landscape = $false
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.OriginAtMargins = $false
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

$doc.add_PrintPage({
  param($sender, $e)

  $g = $e.Graphics
  $g.PageUnit = [System.Drawing.GraphicsUnit]::Display
  $offsetX = [single]($data.offsetX -as [double])
  $offsetY = [single]($data.offsetY -as [double])
  # Rotate 90° CCW: landscape content fits portrait paper (printers expecting 30mm×50mm portrait)
  $g.TranslateTransform(0, [single]$paperWidth)
  $g.RotateTransform(-90)
  $g.TranslateTransform($offsetX, $offsetY)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit

  $black = [System.Drawing.Brushes]::Black
  $white = [System.Drawing.Brushes]::White
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1)
  $fontName = 'Malgun Gothic'
  $titleFont = New-Object System.Drawing.Font($fontName, 7, [System.Drawing.FontStyle]::Bold)
  $codeFont = New-Object System.Drawing.Font('Consolas', 9, [System.Drawing.FontStyle]::Bold)

  $productName = [string]$data.productName
  $barcodeText = [string]$data.barcode
  $labelPrefix = -join ([char[]](0xD488, 0xBAA9, 0xBA85, 0x0020, 0x003A, 0x0020))
  $labelText = $labelPrefix + $productName

  # Calibrated 50mm x 30mm baseline: outerX=12, outerY=4, outerW=paperWidth-26,
  # row1Y=28, row2Y=72, barcodeWidth=outerW-44, centered barcode.
  $outerX = 12
  $outerY = 4
  $outerW = $paperWidth - 26
  $outerH = 94
  $row1Y = 28
  $row2Y = 72

  $g.FillRectangle($black, $outerX, $outerY, $outerW, ($row1Y - $outerY))

  $textRect = New-Object System.Drawing.RectangleF(($outerX + 4), 7, ($outerW - 8), 17)
  $format = New-Object System.Drawing.StringFormat
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($labelText, $titleFont, $white, $textRect, $format)

  $bars = @($data.bars)
  $barModules = [int]$data.barModules
  if ($barModules -le 0) { throw 'Invalid barcode data.' }

  $barcodeY = 37
  $barcodeWidth = $outerW - 8
  $barcodeHeight = 42
  $moduleWidth = $barcodeWidth / $barModules
  $actualBarcodeWidth = $barModules * $moduleWidth
  $barcodeX = $outerX + (($outerW - $actualBarcodeWidth) / 2)
  foreach ($bar in $bars) {
    $x = $barcodeX + ([double]$bar.x * $moduleWidth)
    $w = [Math]::Max(0.35, [double]$bar.w * $moduleWidth)
    $g.FillRectangle($black, [single]$x, [single]$barcodeY, [single]$w, [single]$barcodeHeight)
  }

  $codeSize = $g.MeasureString($barcodeText, $codeFont)
  $codeX = [Math]::Max(0, ($paperWidth - $codeSize.Width) / 2)
  $g.DrawString($barcodeText, $codeFont, $black, [single]$codeX, 84)

  $e.HasMorePages = $false
})

$doc.Print()
