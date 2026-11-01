# 交接记录 · 2026-10-31

本轮所有改动的依据都是**实测值**（浏览器里读模型、读画布像素），不是估计。
下次动这些代码前先看这里，免得重新测一遍。

## 一条根因串起今天所有问题

`2.3dm` 以 **Rhino 世界坐标**导入，而内嵌基线模型是**居中**过的（`meta.origin =
[-308.935, 186.6005, 23.5684]`）。两套坐标系混在一个场景里，场地道路和结构水体
相差约 360 m。修掉对齐之后，后续每个问题都是同一根因的残留：

| 症状 | 实际原因 |
|---|---|
| 场地/道路与结构错开 | 导入几何未平移进场地坐标系 |
| 车辆被停用 | v17 车位表是按旧路网解的 |
| 水面画在错的地方 | 水域从内嵌旧场地算，而非 2.3dm |
| 树长在马路上 | 地块多边形按旧路网切，布点从不检查道路 |

对齐量**不写死**，由导入场地自身包围盒推导（XY 中心归零、顶面归 0），实测与
`meta.origin` 相差 1 mm。换一个摆在别处的 3dm 也能自动落位。

## 关键参数的由来（都试错过，别随手改）

- **水 = 低于路槽底的台地 + 不在道路 footprint 下的 −1 m 河床**。
  2.3dm 的道路嵌在 1 m 深沟槽里，槽底与旧水床**同为 −1 m**。若沿用旧规则
  （所有连通 −1 m 面），实测会淹掉 93,149 m²（场地 40%），马路全在水下。
- **台地阶梯扫描定下限 −6 m**。场地底面在 −25 m，不设下限泛洪会顺盆壁漏下去。
- **路缘用精确多边形裁剪**（取代早先的「扩一圈」）。曾试过的两条死路：
  扩两圈会顺车行道爬进路网；「三顶点全在路下才丢」会拉进 1,642 面 / 31,279 m²。
- **过路处不裁剪**（33 面 / 1,958 m²）。路跨水渠是桥不是岸，床底在底下连通；
  判据是「相对两侧 28 m 内都有水」，沿路并行的水不会被误填。
  **两侧必须都从 −1 m 床面取样**——若改用最终选择集（含岸坡和泛洪面），
  几乎每条路边都会被判成交叉口：实测 3,127 面、水面涨到 72,468 m²。
- **水面 clearcoat 必须为 0**。采样证明：任何 clearcoat 在这套灯光下都把水面
  打成灰白 (219,220,222)；归零后才是 (140,167,186) 的蓝。高光交给波纹线。
- **颜色走 `THREE.Color`**。本项目渲染器的颜色处理下，直接写线性三元组会偏。
- **树冠最大外伸 ≈ 4.3 m，路缘余量 5.1 m**。改树冠尺寸前先核这两个数。

## 待办（按价值排序）

1. **拆分 `index.html`** ← 建议先做这个。
   现状：2 MB base64（`MODEL_GZIP`/`LOD_GZIP`）+ 670 KB three.js 全在一个 HTML 里。
   今天 `1eb9021` 就是在线编辑时被 1 MB 截断，`MODEL_GZIP` 整块消失，
   **线上页面完全打不开**，而 CI 报的却是「水体测试失败」——坏得很安静。
   拆成 `<script src>` 后主文件只剩几十 KB，这类事故从根上消失。
   注意：loader 的 `?v=` 缓存串必须同步 bump，否则回头客拿不到新代码。
2. ~~道路标线按新路网重算~~ **已解决，但不是靠重算**：10/31 的模型自带划线，
   在 `Default` 图层上（536 条曲线 → 2,450 段），平铺在路面标高。导入器按曲线
   采样后原样绘制，不做路口求解，所以不会再和模型脱节。
   **注意**：曲线采样后每条只存一次再整体位移；若按「段端点对」存，中间点会被
   同一引用压两次、位移叠加两遍，线会飞出场地（已踩过）。
   另有 `0` 图层 5,475 段旧线work，暂未绘制。
3. **沿街行道树**。现已做到「不种在路上」，但还没有规整列植。
4. **方案 C：以 2.3dm 为唯一来源**。**地块部分已完成**：不走 Rhino 对象，
   改由「场地减道路减水域」的连通分量现算，得到 **32 个地块 / 140,891 m²**
   （`rebuildParcelsFromRoads`），结构按所在地块重新挂接。
   **剩余**：58 个结构组仍来自内嵌模型。2.3dm 的结构图层只有 1 个对象，
   要按新地块重新分组，得先在 Rhino 里炸开。
5. **加环境贴图**，找回水面反光（为了让水显蓝，clearcoat 已归零）。

## 两个悬而未决、需要你拍板

- 西北角 504 m² 洼地现被判为水；旧代码曾**特意排除**它。保留还是排除？
- 水渠过路处在模型里是**真的被实心路板截断**的，现在看着连续是因为补的水藏在
  路板下。若要在图纸/说明中称其为连续水道，需在 Rhino 中改为桥或涵洞。

## 还有一条教训

今天三次栽在同一处：**裁剪会重算顶点，之后就不能再用「顶点/边重合」推断拓扑**。
先后表现为水边锯齿、过路断流、以及 3,443 条假岸线。涉及水面几何时先想这一条。

## CI 备忘

`verify-road-markings` 今早起一直红，原因是渲染器 v22→v26 改了网格名
（`road-v26-*`），测试仍在找 `road-v22-zebra`。已改为按图层名匹配。
标线本身从未损坏：29 路口 / 88 过街 / 885 条斑马线 / 0 方向错误。

## 道路细节层（v32–v34，10/31 晚）

全部由源几何推导，没有手摆：

- **绿化隔离带**：源里的岛是**开放线**围的（两个线图层零条闭合曲线），没法当多边形读。
  改为：车行道按 0.3 m 栅格化 → 划线烧成「墙」→ 从**路缘**泛洪 → 泛不到的即围合岛。
  **坑**：场地边界不能当种子，否则延伸到边界的绿带会被从切口灌穿（修前漏了一半）。
  结果 3,328 m² / 1,148 株灌木。
- **划线宽度**：WebGL 不支持线宽，必须画成带状面。斑马线判据是「短直线且旁边**并排**
  还有同向短直线」；车道虚线也短也直，但邻居是**首尾相接**的——不区分的话虚线会变成胖方块。
  350 段判为斑马线（0.55 m），其余 0.16 m。
- **车辆朝向**：取最近车道线方向，**不留退路**。原来用「哪个方向能走最远」，
  在中央岛旁会指向斜穿马路。审计：48 辆与车道线最大夹角 0.3°。
  车身还需避开隔离带和斑马线。靠左行驶（偏移取行进方向左法线）。
- **信号灯/路灯**：信号灯放在人行横道两端路缘——**注意斑马线的每道白条是顺行车方向的，
  一排白条才横跨马路**，按白条方向量会把灯杆放到路中央（踩过）。
  灯杆需从横道端向外搜索直到出路面，固定偏移不够（斑马线画不到路缘）。
  84 盏信号灯 / 112 盏路灯。

## Parcel and Form views show the parcel only (v34)

The Form library isolates one plot: the site mesh, the roads mesh and the ground
plane were already hidden, but the water and the planting were not. Both are
modelled against the site — the water keeps the full lagoon and channel extent,
and the trees stand on site levels rather than on the parcel plate — so with the
site gone the water slabs cut straight across the plot and showed their own
section walls from the inside, which is the torn geometry seen in the viewer.

Both now follow the same all-site rule the road markings, the medians, the
furniture and the vehicles already used: visible in 全部场地 and in the three
site modes, hidden as soon as a parcel card or a Form card is open. Nothing was
removed from the water or planting geometry; only their visibility changed.

## Loose edge-wall fins on the structure Forms (v35)

Several of the embedded Rhino render meshes carry a strip of a slab's vertical
edge wall that runs on past the top and bottom surfaces it belongs to. The strip
is about 0.12 m wide and up to 11 m long, so at site zoom it draws as a one-pixel
hair sticking out of the Form — the burrs visible in the Form library.

Two things made it hard to find. The strips are well-formed quads, so every
degenerate-triangle test passes them; three separate sliver filters (zero area,
tiny area, high aspect ratio) removed 1,288 faces and changed nothing on screen.
And removing only the exposed strip is not enough: the wall is several strips
tall, so taking the outer one just uncovers the next. What identifies a fin is
that its LONG edge is shared with no other face — a wall that is properly backed
shares both long edges with a surface and never starts peeling.

`trimLooseFins()` therefore peels iteratively, dropping the exposed strips and
decrementing only their edges so the next pass sees what that uncovered. It runs
once at load over the embedded model and the LOD model: 2,158 of 85,646 faces in
the display model, 0.14 % of the surface area, converging in at most 8 passes,
about 0.6 s for both models together.

`E-01` and `C-11-17-S1` are thin plates by design — the whole object is 0.12 m
strips — so peeling would consume them. Any unit that would lose more than 60 %
of its area is left exactly as the Rhino file has it. If a future source adds
more such elements, they will be named in the console line at load.

No vertex is moved and nothing is added; only faces that bound no solid are
dropped. The OBJ export says so in its header and still writes Rhino world
coordinates.

## Crossings completed against the carriageway (v37)

The 2.3dm Default layer draws 46 crossings as rows of 5 m bars at a 1 m pitch,
0.55 m wide. Measured against the Roads mesh, a row is 4 m, 9 m or 10 m long
where the carriageway at that point is 8 m to 14 m wide, so every zebra stopped
short of both kerbs. Grouping the rows gives 20 junctions with 59 arms between
them, and 13 of those arms carry no crossing in the drawing at all.

`completeCrossings()` closes both gaps without styling anything by hand. The bar
length (5.00 m), bar width (0.55 m) and pitch (1.00 m) are the medians of the
source's own rows. How far a row may run is read from the Roads mesh: a bar is
laid only where the whole 5 m of it is on the carriageway, and never across a
planted median. 181 bars were added to the 46 source rows, and 6 new crossings
(70 bars) on arms that had none.

Two traps are worth keeping in mind.

A single perpendicular walk does not find the kerb at a junction: the road opens
sideways into the mouth and the walk runs on, which stretched one crossing to
44 m. The reach is therefore the NARROWEST section found within 10 m along the
traffic direction, which gives 7 m to 14 m — the real carriageway widths.

Medians are detected by flooding the carriageway raster against the source line
work, so they have to be found BEFORE the completed bars exist, or the new bars
burn in as walls and invent islands. `buildRoadMedians` reads `roadLineOverride`
only; the completed bars live in `roadCrossingOverride` and are drawn, and read
by the signals, but never rasterised.

Still source-led, so still open: the drawing decides where a crossing belongs.
The 6 added ones only fill arms of junctions the drawing already marks; a
junction the drawing ignores entirely stays unmarked.
