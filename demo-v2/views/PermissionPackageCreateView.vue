<template>
  <div class="page-stack">
    <el-row :gutter="20">
      <el-col :span="16">
        <el-card header="权限包模板配置">
          <el-form :model="form" label-width="120px">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="模板名称">
                  <el-input v-model="form.packageName" placeholder="例如：区域运营管理员模板" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="适用系统">
                  <el-select v-model="form.system" placeholder="请选择系统">
                    <el-option label="运营中台" value="ops" />
                    <el-option label="采购平台" value="purchase" />
                    <el-option label="租户中心" value="tenant" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <el-tabs v-model="activeTab">
            <el-tab-pane label="菜单权限" name="menu">
              <div class="permission-panel">
                <el-tree
                  :data="menuTree"
                  show-checkbox
                  node-key="id"
                  default-expand-all
                />
              </div>
            </el-tab-pane>
            <el-tab-pane label="数据范围" name="scope">
              <el-form :model="form" label-width="120px">
                <el-form-item label="可见区域">
                  <el-select v-model="form.regions" multiple collapse-tags placeholder="请选择区域">
                    <el-option label="全国" value="all" />
                    <el-option label="华东" value="east" />
                    <el-option label="华北" value="north" />
                    <el-option label="华南" value="south" />
                  </el-select>
                </el-form-item>
                <el-form-item label="数据级别">
                  <el-radio-group v-model="form.scopeLevel">
                    <el-radio value="self">仅本人</el-radio>
                    <el-radio value="department">本部门</el-radio>
                    <el-radio value="region">本区域</el-radio>
                  </el-radio-group>
                </el-form-item>
              </el-form>
            </el-tab-pane>
            <el-tab-pane label="资源组" name="resource">
              <div class="resource-toolbar">
                <el-button type="primary" @click="drawerVisible = true">添加资源组</el-button>
              </div>
              <el-table :data="resourceRows" border style="width: 100%">
                <el-table-column prop="name" label="资源组名称" min-width="180" />
                <el-table-column prop="desc" label="说明" min-width="220" />
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card header="页面说明">
          <el-alert type="warning" :closable="false" title="这是一个带树形权限和抽屉嵌套的页面">
            <template #default>
              适合测试 AI 在切换 Tab、勾选树节点、打开抽屉并最终提交模板时的复杂操作。
            </template>
          </el-alert>
        </el-card>

        <el-card header="创建记录" style="margin-top: 20px">
          <div class="log-list">
            <div v-if="logs.length === 0" class="empty-log">暂无创建记录</div>
            <div v-for="(item, idx) in logs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <div class="page-actions">
      <el-button @click="activeTab = 'resource'">切到资源组</el-button>
      <el-button type="primary" @click="submitTemplate">保存权限模板</el-button>
    </div>

    <el-drawer v-model="drawerVisible" title="添加资源组" size="560px">
      <el-form :model="resourceForm" label-width="120px">
        <el-form-item label="资源组名称">
          <el-input v-model="resourceForm.name" placeholder="请输入资源组名称" />
        </el-form-item>
        <el-form-item label="资源组说明">
          <el-input v-model="resourceForm.desc" type="textarea" :rows="4" placeholder="请输入说明" />
        </el-form-item>
        <el-form-item label="绑定资源">
          <el-checkbox-group v-model="resourceForm.bindings">
            <el-checkbox value="menu-ops">运营菜单</el-checkbox>
            <el-checkbox value="menu-finance">财务菜单</el-checkbox>
            <el-checkbox value="api-report">报表接口</el-checkbox>
            <el-checkbox value="api-export">导出接口</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" @click="appendResourceGroup">添加资源组</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const activeTab = ref('menu')
const drawerVisible = ref(false)
const logs = ref<string[]>([])

const form = reactive({
  packageName: '',
  system: '',
  regions: [] as string[],
  scopeLevel: 'department',
})

const resourceRows = ref([
  { name: '默认运营资源组', desc: '包含基础菜单与报表查询权限' },
])

const resourceForm = reactive({
  name: '',
  desc: '',
  bindings: [] as string[],
})

const menuTree = [
  {
    id: '1',
    label: '运营中心',
    children: [
      { id: '1-1', label: '发布单管理' },
      { id: '1-2', label: '工单工作台' },
    ],
  },
  {
    id: '2',
    label: '财务中心',
    children: [
      { id: '2-1', label: '对账批次' },
      { id: '2-2', label: '结算单' },
    ],
  },
]

function appendResourceGroup() {
  const label = resourceForm.name || '未命名资源组'
  resourceRows.value.unshift({ name: label, desc: resourceForm.desc || '无说明' })
  drawerVisible.value = false
  ElMessage.success(`资源组「${label}」已添加`)
}

function submitTemplate() {
  const label = form.packageName || '未命名权限模板'
  logs.value.unshift(`已保存：${label}`)
  ElMessage.success(`权限模板「${label}」已保存`)
}
</script>

<style scoped>
.page-stack { display: flex; flex-direction: column; }
.permission-panel { padding: 8px 0; }
.resource-toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.page-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 12px; }
.log-list { display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
.log-item { padding: 8px 10px; border-radius: 8px; background: #f4f7fb; font-size: 12px; color: #303133; }
.empty-log { font-size: 12px; color: #909399; }
</style>
