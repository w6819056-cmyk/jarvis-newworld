/*
   Jarvis / Mark 46 exporter for 3ds Max 2014

   Usage:
   1. Open the 2014 .max source file.
   2. Run this script from MAXScript > Run Script.
   3. Import the generated mark46-source.fbx into the Jarvis pipeline.

   The source scene is not overwritten. The script exports every scene node,
   keeps node transforms and hierarchy, asks the FBX exporter to embed media,
   and writes a small manifest containing node/material/bitmap information.
*/

global jarvisMark46ExportRoot = (getDir #userScripts) + "\\jarvis-mark46-export"

fn jarvisEnsureDirectory path =
(
    if doesFileExist path == false do makeDir path all:true
    path
)

fn jarvisWriteLine stream value =
(
    format "%\n" value to:stream
)

jarvisEnsureDirectory jarvisMark46ExportRoot

local fbxPath = jarvisMark46ExportRoot + "\\mark46-source.fbx"
local manifestPath = jarvisMark46ExportRoot + "\\mark46-manifest.txt"
local manifest = createFile manifestPath

jarvisWriteLine manifest ("source=" + maxFilePath + maxFileName)
jarvisWriteLine manifest ("export=" + fbxPath)
jarvisWriteLine manifest ("nodes=" + (objects.count as string))

for node in objects do
(
    local parentName = if node.parent == undefined then "" else node.parent.name
    local materialName = ""
    if isProperty node #material and node.material != undefined do materialName = node.material.name as string
    jarvisWriteLine manifest ("NODE|" + node.name + "|class=" + (classOf node as string) + "|parent=" + parentName + "|material=" + materialName)
)

local bitmapPaths = #()
for bitmap in (getClassInstances Bitmaptexture) do
(
    if bitmap.filename != undefined and bitmap.filename != "" do
    (
        local path = bitmap.filename as string
        if (findItem bitmapPaths path) == 0 do append bitmapPaths path
    )
)

for path in bitmapPaths do jarvisWriteLine manifest ("BITMAP|" + path)
close manifest

/* Configure the Autodesk FBX exporter when those options exist in this build. */
try (FBXExporterSetParam "PromptOnWarnings" false) catch()
try (FBXExporterSetParam "ShowWarnings" false) catch()
try (FBXExporterSetParam "FileVersion" "FBX201400") catch()
try (FBXExporterSetParam "ASCII" false) catch()
try (FBXExporterSetParam "Embed Media" true) catch()
try (FBXExporterSetParam "Animation" false) catch()
try (FBXExporterSetParam "Cameras" false) catch()
try (FBXExporterSetParam "Lights" false) catch()
try (FBXExporterSetParam "UpAxis" "Y") catch()

/* Export the complete scene so the original hierarchy and transforms survive. */
try
(
    exportFile fbxPath #noPrompt using:FBXEXP selectedOnly:false
)
catch
(
    messageBox "FBX 导出失败。请确认 3ds Max 已安装 FBX 导出器，并检查输出目录。" title:"Jarvis Mark 46 导出"
)

if doesFileExist fbxPath then
(
    messageBox ("导出完成：\n" + fbxPath + "\n\n清单：\n" + manifestPath) title:"Jarvis Mark 46 导出"
)
else
(
    messageBox ("没有找到导出文件：\n" + fbxPath) title:"Jarvis Mark 46 导出"
)
