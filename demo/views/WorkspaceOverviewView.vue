<template>
  <div class="scenario-page">
    <el-alert
      title="这是一个模拟真实 B 端项目的信息架构入口"
      type="info"
      show-icon
      :closable="false"
    >
      <template #default>
        左侧菜单提供多个深层级业务路由。可以让 AI 先识别菜单，再进入具体页面执行创建动作。
      </template>
    </el-alert>

    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="16">
        <el-card header="推荐测试路线">
          <el-timeline>
            <el-timeline-item
              v-for="item in routeCards"
              :key="item.path"
              :timestamp="item.path"
              placement="top"
            >
              <div class="route-card-row">
                <div>
                  <div class="route-card-title">{{ item.title }}</div>
                  <div class="route-card-desc">{{ item.description }}</div>
                </div>
                <el-button type="primary" plain @click="router.push(item.path)">进入页面</el-button>
              </div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card header="推荐口令">
          <div class="prompt-list">
            <div v-for="(prompt, idx) in prompts" :key="idx" class="prompt-item">{{ prompt }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="12">
        <el-card header="路由分层结构">
          <el-tree :data="treeData" node-key="id" default-expand-all />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card header="测试建议">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="导航能力">
              先让 AI 从左侧菜单进入深层页面，而不是直接操作当前表单。
            </el-descriptions-item>
            <el-descriptions-item label="表单链路">
              测试连续填充多个字段、打开抽屉或弹窗、再点击提交按钮。
            </el-descriptions-item>
            <el-descriptions-item label="效果检查">
              创建成功后页面会出现成功消息和最近操作记录，可用于验证执行结果。
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const routeCards = [
  {
    title: '运营中心 / 变更管理 / 发布单 / 新建发布单',
    path: '/operations/change/release/create',
    description: '适合测试 AI 在复杂字段组合中创建发布单。',
  },
  {
    title: '采购中心 / 供应商管理 / 准入申请 / 新建申请',
    path: '/procurement/supplier/onboarding/request/create',
    description: '适合测试先打开抽屉再填写申请表单。',
  },
  {
    title: '主数据中心 / 客户资料 / 企业客户 / 新建企业客户',
    path: '/master-data/customer/corporate/profile/create',
    description: '适合测试多分组表单、开票信息和联系人信息录入。',
  },
  {
    title: '平台配置 / 租户中心 / 应用开通 / 新建实例',
    path: '/platform/tenant-center/application/provisioning/create',
    description: '适合测试弹窗 + 步骤流的开通场景。',
  },
  {
    title: '财务中心 / 对账管理 / 批次作业 / 新建对账批次',
    path: '/finance/reconciliation/statement/batch/create',
    description: '适合测试抽屉 Tab、规则配置和二次确认。',
  },
  {
    title: '服务台 / 工单中心 / 工作台 / 工单升级申请',
    path: '/service-desk/ticket/workbench/escalation/create',
    description: '适合测试列表筛选、行内操作、抽屉内再开弹窗。',
  },
  {
    title: '安全中心 / 访问控制 / 权限包管理 / 新建权限模板',
    path: '/security/access-control/package/template/create',
    description: '适合测试树形权限、多 Tab 和资源组抽屉。',
  },
]

const prompts = [
  '进入运营中心的“新建发布单”页面，创建一个名为「支付域夜间灰度发布」的发布单。',
  '进入采购中心的供应商准入申请页，点击“新建准入申请”，创建一个华东区域的物流供应商申请。',
  '进入主数据中心的新建企业客户页，创建一个企业客户“星云零售集团”。',
  '进入平台配置的开通应用实例页，点击“开通新实例”，为租户“华北一区”开通 BI 分析应用。',
  '进入财务中心的新建对账批次页，创建一个名为「2026-03 华东渠道对账批次」的批次并确认生成。',
  '进入服务台的工单升级申请页，搜索支付，针对支付工单发起升级并选择支付故障升级群。',
  '进入安全中心的新建权限模板页，创建一个“区域运营管理员模板”，并添加一个资源组。',
]

const treeData = [
  {
    id: '1',
    label: '工作台',
    children: [{ id: '1-1', label: '场景总览' }],
  },
  {
    id: '2',
    label: '运营中心',
    children: [{ id: '2-1', label: '变更管理 / 发布单 / 新建发布单' }],
  },
  {
    id: '3',
    label: '采购中心',
    children: [{ id: '3-1', label: '供应商管理 / 准入申请 / 新建申请' }],
  },
  {
    id: '4',
    label: '主数据中心',
    children: [{ id: '4-1', label: '客户资料 / 企业客户 / 新建企业客户' }],
  },
  {
    id: '5',
    label: '平台配置',
    children: [{ id: '5-1', label: '租户中心 / 应用开通 / 新建实例' }],
  },
  {
    id: '6',
    label: '财务中心',
    children: [{ id: '6-1', label: '对账管理 / 批次作业 / 新建对账批次' }],
  },
  {
    id: '7',
    label: '服务台',
    children: [{ id: '7-1', label: '工单中心 / 工作台 / 工单升级申请' }],
  },
  {
    id: '8',
    label: '安全中心',
    children: [{ id: '8-1', label: '访问控制 / 权限包管理 / 新建权限模板' }],
  },
]
</script>

<style scoped>
.scenario-page {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.route-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.route-card-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.route-card-desc {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.prompt-item {
  font-size: 12px;
  line-height: 1.6;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f4f7fb;
  color: #303133;
}
</style>
